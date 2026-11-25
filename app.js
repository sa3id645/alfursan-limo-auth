// ==================== إعدادات Supabase السحابية ====================
const SUPABASE_URL = "https://jrbcrzfcspcjszrkcxmv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyYmNyemZjc3BjanN6cmtjeG12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3MjYwMzMsImV4cCI6MjExMDMwMjAzM30.ZOAO38R-uNhirCyPnO_X1vEpM-1eXkMo3ESCQR4TgC8";

let supabaseClient = null;
try {
  if (
    SUPABASE_URL &&
    SUPABASE_KEY &&
    window.supabase &&
    typeof window.supabase.createClient === "function"
  ) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (e) {
  console.warn("Supabase initialization error:", e);
}

const $ = (id) => document.getElementById(id);
let trips = [];
let currentUser = null;
let currentRole = "user"; // 'admin' أو 'user'
let authListenerBound = false;

const isAdmin = () => currentRole === "admin";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  );

const escJs = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");

const num = (id) => Math.max(0, Number($(id)?.value) || 0);

const money = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) +
  " ج.م";

const opExpenses = (t) =>
  (Number(t.fuel) || 0) +
  (Number(t.tolls) || 0) +
  (Number(t.permits) || 0) +
  (Number(t.other) || 0);

const carNet = (t) =>
  (Number(t.fare) || 0) - opExpenses(t) - (Number(t.wage) || 0);

const driverSettle = (t) =>
  (Number(t.collected) || 0) +
  (Number(t.custody) || 0) -
  (opExpenses(t) + (Number(t.wage) || 0));

const due = (t) => (Number(t.fare) || 0) - (Number(t.collected) || 0);
const driverName = (t) => (t.driver || "").trim() || "بدون سائق محدد";
const carName = (t) => (t.car || "").trim() || "بدون سيارة";

function formatDue(d) {
  if (d > 0) return '<span class="redtxt">متبقي ' + money(d) + "</span>";
  if (d < 0)
    return '<span class="greentxt">زيادة ' + money(Math.abs(d)) + "</span>";
  return "0 ج.م";
}

function formatSettle(s) {
  if (s > 0)
    return '<strong class="greentxt">تستلم منه: ' + money(s) + "</strong>";
  if (s < 0)
    return (
      '<strong class="redtxt">له عندك: ' + money(Math.abs(s)) + "</strong>"
    );
  return "<strong>0 ج.م (خالص)</strong>";
}

function saveLocalTrips(list) {
  if (!isAdmin()) return;
  try {
    localStorage.setItem("forsanTrips", JSON.stringify(list));
  } catch (e) {
    console.warn("LocalStorage save warning:", e);
  }
}

function applyRolePermissions() {
  const admin = isAdmin();

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", !admin);
  });

  const activeTab = document.querySelector(".tabs button.active")?.dataset?.tab;
  if (!admin && activeTab && !["dashboard", "add"].includes(activeTab)) {
    showSection("dashboard");
  }

  if ($("userBar") && currentUser) {
    $("userBar").classList.remove("hidden");
    if ($("currentUserEmail")) {
      $("currentUserEmail").textContent = currentUser.email || "";
    }
    if ($("currentUserRole")) {
      $("currentUserRole").textContent = admin ? "أدمن" : "مستخدم";
      $("currentUserRole").className = "role-pill " + (admin ? "admin" : "user");
    }
  }
}

async function fetchUserRole(userId, email = "") {
  if (!supabaseClient || !userId) return "user";
  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (!error && data?.role) {
      return String(data.role).trim().toLowerCase() === "admin" ? "admin" : "user";
    }

    if (email) {
      const { data: byEmail, error: emailErr } = await supabaseClient
        .from("profiles")
        .select("role")
        .ilike("email", email.trim())
        .maybeSingle();

      if (!emailErr && byEmail?.role) {
        return String(byEmail.role).trim().toLowerCase() === "admin" ? "admin" : "user";
      }
    }
  } catch (e) {
    console.warn("Role lookup warning:", e);
  }
  return "user";
}

async function initAuth() {
  if (!supabaseClient) {
    $("authModal")?.classList.add("hidden");
    await loadTrips();
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data?.session?.user || null;

  if (!currentUser) {
    trips = [];
    render();
    $("userBar")?.classList.add("hidden");
    $("authModal")?.classList.remove("hidden");
  } else {
    currentRole = await fetchUserRole(currentUser.id, currentUser.email);
    $("authModal")?.classList.add("hidden");
    applyRolePermissions();
    await loadTrips();
  }

  if (!authListenerBound) {
    authListenerBound = true;
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = session?.user || null;
      const changed = nextUser?.id !== currentUser?.id;
      currentUser = nextUser;

      if (!currentUser) {
        currentRole = "user";
        trips = [];
        render();
        $("userBar")?.classList.add("hidden");
        $("authModal")?.classList.remove("hidden");
        return;
      }

      if (changed) {
        currentRole = await fetchUserRole(currentUser.id, currentUser.email);
        $("authModal")?.classList.add("hidden");
        applyRolePermissions();
        await loadTrips();
      }
    });
  }
}

async function logoutUser() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
}

function mapTripRow(row) {
  const admin = isAdmin();
  return {
    id: String(row.id),
    date: row.date || "",
    car: row.car || "",
    driver: row.driver || "",
    from: row.from_loc || "",
    to: row.to_loc || "",
    fare: Number(row.fare) || 0,
    collection: row.collection || "",
    collected: Number(row.collected) || 0,
    custody: admin ? Number(row.custody) || 0 : 0,
    fuel: Number(row.fuel) || 0,
    tolls: Number(row.tolls) || 0,
    permits: Number(row.permits) || 0,
    other: Number(row.other) || 0,
    wage: admin ? Number(row.wage) || 0 : 0,
    notes: row.notes || "",
  };
}

async function loadTrips() {
  if (!currentUser && supabaseClient) {
    trips = [];
    render();
    return;
  }

  if (isAdmin()) {
    try {
      const localData = JSON.parse(localStorage.getItem("forsanTrips") || "[]");
      if (Array.isArray(localData)) trips = localData;
    } catch (e) {
      trips = [];
    }
    render();
  }

  if (supabaseClient) {
    try {
      const result = isAdmin()
        ? await supabaseClient
            .from("trips")
            .select("*")
            .order("date", { ascending: false })
        : await supabaseClient.rpc("get_recent_trips", { lim: 10 });

      const { data, error } = result;
      if (!error && Array.isArray(data)) {
        trips = data.map(mapTripRow);
        if (isAdmin()) saveLocalTrips(trips);
      }
    } catch (err) {
      console.warn("Cloud sync load warning:", err);
    }
  }
  render();
}

async function persist(t) {
  if (isAdmin()) {
    saveLocalTrips(trips);
  }

  if (supabaseClient) {
    try {
      const row = {
        id: String(t.id),
        date: t.date,
        car: t.car,
        driver: t.driver,
        from_loc: t.from,
        to_loc: t.to,
        fare: t.fare,
        collection: t.collection,
        collected: t.collected,
        custody: isAdmin() ? t.custody : 0,
        fuel: t.fuel,
        tolls: t.tolls,
        permits: t.permits,
        other: t.other,
        wage: isAdmin() ? t.wage : 0,
        notes: t.notes,
      };
      const { error } = await supabaseClient.from("trips").upsert([row]);
      if (error) {
        console.warn("Supabase upsert error:", error.message);
        alert("تعذر حفظ الرحلة سحابياً: " + error.message);
        return;
      }
    } catch (err) {
      console.warn("Cloud upsert exception:", err);
    }
  }

  if (!isAdmin()) {
    await loadTrips();
  } else {
    render();
  }
}

async function deleteTripCloud(id) {
  if (!isAdmin()) return;
  trips = trips.filter((t) => t.id !== id);
  saveLocalTrips(trips);
  if (supabaseClient) {
    try {
      await supabaseClient.from("trips").delete().eq("id", id);
    } catch (err) {
      console.warn("Delete cloud error:", err);
    }
  }
  render();
}

function showSection(id) {
  if (!isAdmin() && !["dashboard", "add"].includes(id)) {
    id = "dashboard";
  }

  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.toggle("active", s.id === id));
  document
    .querySelectorAll(".tabs button")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === id));

  if (id === "add" && $("date")) {
    $("date").value ||= new Date().toISOString().slice(0, 10);
  }
  if (id === "carDetail" && isAdmin()) renderCarDetail();
  if (id === "driverDetail" && isAdmin()) renderDriverDetail();
}

function openCarAccount(name, month = "") {
  if (!isAdmin()) return;
  showSection("carDetail");
  if ($("carPicker")) $("carPicker").value = name;
  if (month && $("carMonth")) $("carMonth").value = month;
  renderCarDetail();
}

function openDriverAccount(name, month = "") {
  if (!isAdmin()) return;
  showSection("driverDetail");
  if ($("driverPicker")) $("driverPicker").value = name;
  if ($("driverFromDate")) $("driverFromDate").value = "";
  if ($("driverToDate")) $("driverToDate").value = "";
  if (month && $("driverMonth")) $("driverMonth").value = month;
  renderDriverDetail();
}

function clearFilter(inputId, callback) {
  if ($(inputId)) $(inputId).value = "";
  if (typeof callback === "function") callback();
}

function resetDriverFilters() {
  if ($("driverMonth")) $("driverMonth").value = "";
  if ($("driverFromDate")) $("driverFromDate").value = "";
  if ($("driverToDate")) $("driverToDate").value = "";
  renderDriverDetail();
}

function updateCalc() {
  if (!$("liveCalc")) return;
  const e = num("fuel") + num("tolls") + num("permits") + num("other");
  const f = num("fare"),
    w = num("wage"),
    c = num("collected"),
    cust = num("custody");
  const profit = f - e - w;
  const settle = c + cust - (e + w);
  const settleTxt =
    settle > 0
      ? `تستلم من السائق: ${money(settle)}`
      : settle < 0
      ? `تدفع للسائق: ${money(Math.abs(settle))}`
      : "خالص (0 ج.م)";

  $("liveCalc").innerHTML = `
    <strong>ملخص فوري:</strong> مصاريف التشغيل: <strong>${money(
      e
    )}</strong> | أجرة السائق: <strong>${money(
    w
  )}</strong> | ربح السيارة: <strong class="${
    profit >= 0 ? "greentxt" : "redtxt"
  }">${money(profit)}</strong><br>
    تصفية السائق: <strong class="${
      settle >= 0 ? "greentxt" : "redtxt"
    }">${settleTxt}</strong>
  `;
}

function resetForm() {
  if (!$("tripForm")) return;
  $("tripForm").reset();
  if ($("editId")) $("editId").value = "";
  if ($("formTitle")) $("formTitle").textContent = "تسجيل رحلة جديدة";
  ["collected", "custody", "fuel", "tolls", "permits", "other", "wage"].forEach(
    (x) => {
      if ($(x)) $(x).value = 0;
    }
  );
  if ($("date")) $("date").value = new Date().toISOString().slice(0, 10);
  updateCalc();
}

function editTrip(id) {
  if (!isAdmin()) return;
  const t = trips.find((x) => x.id === id);
  if (!t) return;
  showSection("add");
  if ($("formTitle")) $("formTitle").textContent = "تعديل بيانات الرحلة";
  Object.keys(t).forEach((k) => {
    if ($(k)) $(k).value = t[k];
  });
  if ($("editId")) $("editId").value = t.id;
  updateCalc();
}

function deleteTrip(id) {
  if (!isAdmin()) return;
  if (confirm("هل تريد حذف الرحلة نهائيًا من السحاب والمحلي؟")) {
    deleteTripCloud(id);
  }
}

function getCarsSummary(monthFilter = "") {
  const map = {};
  trips
    .filter((t) => !monthFilter || (t.date || "").startsWith(monthFilter))
    .forEach((t) => {
      const c = carName(t);
      map[c] ??= {
        name: c,
        n: 0,
        f: 0,
        col: 0,
        e: 0,
        w: 0,
        nt: 0,
        d: 0,
        drivers: {},
      };
      const x = map[c];
      x.n++;
      x.f += Number(t.fare) || 0;
      x.col += Number(t.collected) || 0;
      x.e += opExpenses(t);
      x.w += Number(t.wage) || 0;
      x.nt += carNet(t);
      x.d += due(t);
      const d = driverName(t);
      x.drivers[d] = (x.drivers[d] || 0) + 1;
    });
  return map;
}

function getDriversSummary(monthFilter = "") {
  const map = {};
  trips
    .filter((t) => !monthFilter || (t.date || "").startsWith(monthFilter))
    .forEach((t) => {
      const d = driverName(t);
      map[d] ??= {
        name: d,
        n: 0,
        f: 0,
        col: 0,
        cust: 0,
        e: 0,
        w: 0,
        settle: 0,
        cars: {},
      };
      const x = map[d];
      x.n++;
      x.f += Number(t.fare) || 0;
      x.col += Number(t.collected) || 0;
      x.cust += Number(t.custody) || 0;
      x.e += opExpenses(t);
      x.w += Number(t.wage) || 0;
      x.settle += driverSettle(t);
      const c = carName(t);
      x.cars[c] = (x.cars[c] || 0) + 1;
    });
  return map;
}

function renderCarDetail() {
  if (!isAdmin() || !$("carPicker")) return;
  const chosen = $("carPicker").value;
  const mFilter = $("carMonth")?.value || "";
  const list = trips.filter(
    (t) =>
      (!chosen || carName(t) === chosen) &&
      (!mFilter || (t.date || "").startsWith(mFilter))
  );

  const count = list.length;
  const fareSum = list.reduce((s, t) => s + (Number(t.fare) || 0), 0);
  const colSum = list.reduce((s, t) => s + (Number(t.collected) || 0), 0);
  const dueSum = list.reduce((s, t) => s + due(t), 0);
  const expSum = list.reduce((s, t) => s + opExpenses(t), 0);
  const wageSum = list.reduce((s, t) => s + (Number(t.wage) || 0), 0);
  const netSum = list.reduce((s, t) => s + carNet(t), 0);
  const avgNet = count ? netSum / count : 0;

  if ($("cdCount")) $("cdCount").textContent = count;
  if ($("cdFare")) $("cdFare").textContent = money(fareSum);
  if ($("cdCollected")) $("cdCollected").textContent = money(colSum);
  if ($("cdDue")) $("cdDue").textContent = money(dueSum);
  if ($("cdExpenses")) $("cdExpenses").textContent = money(expSum);
  if ($("cdWages")) $("cdWages").textContent = money(wageSum);
  if ($("cdAvgNet")) $("cdAvgNet").textContent = money(avgNet);
  if ($("cdNet")) {
    $("cdNet").textContent = money(netSum);
    $("cdNet").className = "v " + (netSum >= 0 ? "greentxt" : "redtxt");
  }

  const fuelS = list.reduce((s, t) => s + (Number(t.fuel) || 0), 0);
  const tollsS = list.reduce((s, t) => s + (Number(t.tolls) || 0), 0);
  const permS = list.reduce((s, t) => s + (Number(t.permits) || 0), 0);
  const otherS = list.reduce((s, t) => s + (Number(t.other) || 0), 0);

  if ($("cdExpenseBreakdown")) {
    $("cdExpenseBreakdown").innerHTML = `
      <span class="chip">بنزين: ${money(fuelS)}</span>
      <span class="chip">بوابات: ${money(tollsS)}</span>
      <span class="chip">تصاريح: ${money(permS)}</span>
      <span class="chip">أخرى: ${money(otherS)}</span>
    `;
  }

  const drvMap = {};
  list.forEach((t) => {
    const d = driverName(t);
    drvMap[d] = (drvMap[d] || 0) + 1;
  });

  if ($("cdDriversList")) {
    $("cdDriversList").innerHTML = Object.keys(drvMap).length
      ? Object.entries(drvMap)
          .map(([d, cnt]) => `<span class="chip">${esc(d)} (${cnt} رحلة)</span>`)
          .join("")
      : '<span class="note">لا يوجد سائقون</span>';
  }

  if ($("carPrintSubTitle")) {
    $("carPrintSubTitle").textContent = `السيارة: ${chosen || "جميع السيارات"} ${
      mFilter ? " | الفترة: " + mFilter : " | كل الفترات"
    }`;
  }

  if ($("carDetailRows")) {
    $("carDetailRows").innerHTML = list.length
      ? list
          .map(
            (t) => `<tr>
      <td>${esc(t.date)}</td>
      <td>${esc(driverName(t))}</td>
      <td>${esc(t.from)} ← ${esc(t.to)}</td>
      <td>${money(t.fare)}</td>
      <td class="greentxt">${money(t.collected)}</td>
      <td>${money(opExpenses(t))}</td>
      <td>${money(t.wage)}</td>
      <td class="${carNet(t) >= 0 ? "greentxt" : "redtxt"}"><strong>${money(
              carNet(t)
            )}</strong></td>
      <td>${formatDue(due(t))}</td>
      <td>${esc(t.notes || "—")}</td>
    </tr>`
          )
          .join("")
      : '<tr><td colspan="10" class="empty">لا توجد رحلات مطابقة</td></tr>';
  }

  if ($("carDetailFoot")) {
    $("carDetailFoot").innerHTML = list.length
      ? `<tr>
      <td colspan="3">الإجمالي</td>
      <td>${money(fareSum)}</td>
      <td class="greentxt">${money(colSum)}</td>
      <td>${money(expSum)}</td>
      <td>${money(wageSum)}</td>
      <td class="${netSum >= 0 ? "greentxt" : "redtxt"}">${money(netSum)}</td>
      <td>${formatDue(dueSum)}</td>
      <td></td>
    </tr>`
      : "";
  }
}

function renderDriverDetail() {
  if (!isAdmin() || !$("driverPicker")) return;
  const chosen = $("driverPicker").value;
  const fromD = $("driverFromDate")?.value || "";
  const toD = $("driverToDate")?.value || "";
  const mFilter = $("driverMonth")?.value || "";

  const list = trips.filter((t) => {
    if (chosen && driverName(t) !== chosen) return false;
    if (mFilter && !(t.date || "").startsWith(mFilter)) return false;
    if (fromD && (t.date || "") < fromD) return false;
    if (toD && (t.date || "") > toD) return false;
    return true;
  });

  const count = list.length;
  const colSum = list.reduce((s, t) => s + (Number(t.collected) || 0), 0);
  const custSum = list.reduce((s, t) => s + (Number(t.custody) || 0), 0);
  const inHand = colSum + custSum;
  const expSum = list.reduce((s, t) => s + opExpenses(t), 0);
  const wageSum = list.reduce((s, t) => s + (Number(t.wage) || 0), 0);
  const deductSum = expSum + wageSum;
  const settleSum = inHand - deductSum;

  if ($("ddCount")) $("ddCount").textContent = count;
  if ($("ddCollected")) $("ddCollected").textContent = money(colSum);
  if ($("ddCustody")) $("ddCustody").textContent = money(custSum);
  if ($("ddTotalInHand")) $("ddTotalInHand").textContent = money(inHand);
  if ($("ddExpenses")) $("ddExpenses").textContent = money(expSum);
  if ($("ddWages")) $("ddWages").textContent = money(wageSum);
  if ($("ddTotalDeduct")) $("ddTotalDeduct").textContent = money(deductSum);
  if ($("ddSettle")) {
    $("ddSettle").textContent = money(Math.abs(settleSum));
    $("ddSettle").className = "v " + (settleSum >= 0 ? "greentxt" : "redtxt");
  }
  if ($("ddSettleLabel")) {
    $("ddSettleLabel").textContent =
      settleSum > 0
        ? "صافي المطلوب استلامه من السائق"
        : settleSum < 0
        ? "صافي المستحق للسائق منك"
        : "الصافي المطلوب (خالص)";
  }

  const carMap = {};
  list.forEach((t) => {
    const c = carName(t);
    carMap[c] = (carMap[c] || 0) + 1;
  });

  if ($("ddCarsList")) {
    $("ddCarsList").innerHTML = Object.keys(carMap).length
      ? Object.entries(carMap)
          .map(([c, cnt]) => `<span class="chip">${esc(c)} (${cnt} رحلة)</span>`)
          .join("")
      : '<span class="note">لا توجد سيارات</span>';
  }

  const periodTxt = mFilter
    ? `الشهر: ${mFilter}`
    : fromD || toD
    ? `من ${fromD || "البداية"} إلى ${toD || "النهاية"}`
    : "كل الفترات";

  if ($("driverPrintSubTitle")) {
    $("driverPrintSubTitle").textContent = `السائق: ${
      chosen || "جميع السائقين"
    } | ${periodTxt}`;
  }

  if ($("driverDetailRows")) {
    $("driverDetailRows").innerHTML = list.length
      ? list
          .map(
            (t) => `<tr>
      <td>${esc(t.date)}</td>
      <td>${esc(carName(t))}</td>
      <td>${esc(t.from)} ← ${esc(t.to)}</td>
      <td>${money(t.fare)}</td>
      <td>${money(t.collected)}</td>
      <td class="bluetxt">${money(t.custody || 0)}</td>
      <td>${money(opExpenses(t))}</td>
      <td>${money(t.wage)}</td>
      <td>${formatSettle(driverSettle(t))}</td>
      <td>${esc(t.notes || "—")}</td>
    </tr>`
          )
          .join("")
      : '<tr><td colspan="10" class="empty">لا توجد رحلات مطابقة</td></tr>';
  }

  if ($("driverDetailFoot")) {
    $("driverDetailFoot").innerHTML = list.length
      ? `<tr>
      <td colspan="3">الإجمالي</td>
      <td>${money(list.reduce((s, t) => s + (Number(t.fare) || 0), 0))}</td>
      <td>${money(colSum)}</td>
      <td class="bluetxt">${money(custSum)}</td>
      <td>${money(expSum)}</td>
      <td>${money(wageSum)}</td>
      <td>${formatSettle(settleSum)}</td>
      <td></td>
    </tr>`
      : "";
  }
}

function render() {
  const admin = isAdmin();

  if ($("recentRows")) {
    $("recentRows").innerHTML =
      trips
        .slice(0, 10)
        .map(
          (t) => `<tr>
      <td>${esc(t.date)}</td>
      <td>${
        admin
          ? `<button class="linkbtn" onclick="openCarAccount('${escJs(
              carName(t)
            )}')">${esc(carName(t))}</button>`
          : esc(carName(t))
      }</td>
      <td>${
        t.driver
          ? admin
            ? `<button class="linkbtn" onclick="openDriverAccount('${escJs(
                driverName(t)
              )}')">${esc(driverName(t))}</button>`
            : esc(driverName(t))
          : "—"
      }</td>
      <td>${esc(t.from)} ← ${esc(t.to)}</td>
      <td>${money(t.fare)}</td>
      <td>${money(t.collected)}</td>
      ${admin ? `<td class="bluetxt">${money(t.custody || 0)}</td>` : ""}
      ${admin ? `<td>${formatSettle(driverSettle(t))}</td>` : ""}
      ${
        admin
          ? `<td class="${carNet(t) >= 0 ? "greentxt" : "redtxt"}">${money(
              carNet(t)
            )}</td>`
          : ""
      }
    </tr>`
        )
        .join("") ||
      `<tr><td colspan="${admin ? 9 : 6}" class="empty">لا توجد رحلات</td></tr>`;
  }

  if (!admin) return;

  const total = (k) => trips.reduce((s, t) => s + (Number(k(t)) || 0), 0);
  if ($("totalRevenue")) $("totalRevenue").textContent = money(total((t) => t.fare));
  if ($("totalCollected")) $("totalCollected").textContent = money(total((t) => t.collected));
  if ($("totalCosts")) {
    $("totalCosts").textContent = money(
      total((t) => opExpenses(t) + (Number(t.wage) || 0))
    );
  }
  if ($("totalNet")) $("totalNet").textContent = money(total(carNet));
  if ($("totalDue")) $("totalDue").textContent = money(total(due));
  if ($("totalCustody")) $("totalCustody").textContent = money(total((t) => t.custody));
  if ($("totalExpenses")) $("totalExpenses").textContent = money(total(opExpenses));
  if ($("totalWages")) $("totalWages").textContent = money(total((t) => t.wage));

  const row = (t) => `<tr>
    <td>${esc(t.date)}</td>
    <td><button class="linkbtn" onclick="openCarAccount('${escJs(
      carName(t)
    )}')">${esc(carName(t))}</button><br>${
    t.driver
      ? `<button class="linkbtn sub-link" onclick="openDriverAccount('${escJs(
          driverName(t)
        )}')">${esc(t.driver)}</button>`
      : "—"
  }</td>
    <td>${esc(t.from)} ← ${esc(t.to)}</td>
    <td>${money(t.fare)}</td>
    <td>${money(t.collected)}<br><span class="tag ${
    due(t) <= 0 ? "ok" : "no"
  }">${esc(t.collection)}</span></td>
    <td class="bluetxt"><strong>${money(t.custody || 0)}</strong></td>
    <td>${money(opExpenses(t))}</td>
    <td>${money(t.wage)}</td>
    <td>${formatSettle(driverSettle(t))}</td>
    <td><strong class="${carNet(t) >= 0 ? "greentxt" : "redtxt"}">${money(
    carNet(t)
  )}</strong></td>
    <td><button class="light" onclick="editTrip('${escJs(
      t.id
    )}')">تعديل</button> <button class="danger" onclick="deleteTrip('${escJs(
    t.id
  )}')">حذف</button></td>
  </tr>`;

  if ($("tripRows")) {
    const searchVal = ($("search")?.value || "").toLowerCase();
    const monthVal = $("monthFilter")?.value || "";
    const colVal = $("collectionFilter")?.value || "";

    $("tripRows").innerHTML = trips.length
      ? trips
          .filter(
            (t) =>
              (!searchVal ||
                [t.car, t.driver, t.from, t.to]
                  .join(" ")
                  .toLowerCase()
                  .includes(searchVal)) &&
              (!monthVal || (t.date || "").startsWith(monthVal)) &&
              (!colVal || t.collection === colVal)
          )
          .map(row)
          .join("")
      : '<tr><td colspan="11" class="empty">لا توجد رحلات مسجلة</td></tr>';
  }

  const allCarsSet = new Set(trips.map(carName));
  if ($("carsList")) {
    $("carsList").innerHTML = [...allCarsSet]
      .filter((c) => c !== "بدون سيارة")
      .map((c) => `<option value="${esc(c)}">`)
      .join("");
  }
  if ($("carPicker")) {
    const chosenCar = $("carPicker").value;
    $("carPicker").innerHTML =
      '<option value="">اختر السيارة</option>' +
      [...allCarsSet]
        .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
        .join("");
    if (allCarsSet.has(chosenCar)) $("carPicker").value = chosenCar;
  }

  const carSumMonth = $("carsSummaryMonth")?.value || "";
  const carsMap = getCarsSummary(carSumMonth);
  const cEntries = Object.values(carsMap).sort((a, b) => b.nt - a.nt);

  if ($("csTotalCars")) {
    $("csTotalCars").textContent = cEntries.filter(
      (x) => x.name !== "بدون سيارة"
    ).length;
  }
  if ($("csTotalTrips")) {
    $("csTotalTrips").textContent = cEntries.reduce((s, x) => s + x.n, 0);
  }
  if ($("csTotalFares")) {
    $("csTotalFares").textContent = money(cEntries.reduce((s, x) => s + x.f, 0));
  }
  const csNet = cEntries.reduce((s, x) => s + x.nt, 0);
  if ($("csTotalNet")) {
    $("csTotalNet").textContent = money(csNet);
    $("csTotalNet").className = "v " + (csNet >= 0 ? "greentxt" : "redtxt");
  }

  if ($("carRows") && $("carTotalsFoot")) {
    if (cEntries.length) {
      $("carRows").innerHTML = cEntries
        .map(
          (x) => `<tr>
        <td><button class="linkbtn" onclick="openCarAccount('${escJs(
          x.name
        )}','${escJs(carSumMonth)}')">${esc(x.name)}</button></td>
        <td><strong>${x.n}</strong></td>
        <td>${Object.entries(x.drivers)
          .map(([d, cnt]) => `<span class="tag">${esc(d)} (${cnt})</span>`)
          .join(" ")}</td>
        <td>${money(x.f)}</td>
        <td class="greentxt">${money(x.col)}</td>
        <td>${money(x.e)}</td>
        <td>${money(x.w)}</td>
        <td class="${x.nt >= 0 ? "greentxt" : "redtxt"}"><strong>${money(
            x.nt
          )}</strong></td>
        <td>${formatDue(x.d)}</td>
        <td><button class="light" onclick="openCarAccount('${escJs(
          x.name
        )}','${escJs(carSumMonth)}')">كشف</button></td>
      </tr>`
        )
        .join("");

      $("carTotalsFoot").innerHTML = `<tr>
        <td>الإجمالي</td>
        <td>${cEntries.reduce((s, x) => s + x.n, 0)}</td>
        <td></td>
        <td>${money(cEntries.reduce((s, x) => s + x.f, 0))}</td>
        <td class="greentxt">${money(
          cEntries.reduce((s, x) => s + x.col, 0)
        )}</td>
        <td>${money(cEntries.reduce((s, x) => s + x.e, 0))}</td>
        <td>${money(cEntries.reduce((s, x) => s + x.w, 0))}</td>
        <td class="${csNet >= 0 ? "greentxt" : "redtxt"}">${money(csNet)}</td>
        <td>${formatDue(cEntries.reduce((s, x) => s + x.d, 0))}</td>
        <td></td>
      </tr>`;
    } else {
      $("carRows").innerHTML =
        '<tr><td colspan="10" class="empty">لا توجد بيانات</td></tr>';
      $("carTotalsFoot").innerHTML = "";
    }
  }

  renderCarDetail();

  const allDriversSet = new Set(trips.map(driverName));
  if ($("driversList")) {
    $("driversList").innerHTML = [...allDriversSet]
      .filter((d) => d !== "بدون سائق محدد")
      .map((d) => `<option value="${esc(d)}">`)
      .join("");
  }
  if ($("driverPicker")) {
    const chosenDriver = $("driverPicker").value;
    $("driverPicker").innerHTML =
      '<option value="">اختر السائق</option>' +
      [...allDriversSet]
        .map((d) => `<option value="${esc(d)}">${esc(d)}</option>`)
        .join("");
    if (allDriversSet.has(chosenDriver)) $("driverPicker").value = chosenDriver;
  }

  const drvSumMonth = $("driversSummaryMonth")?.value || "";
  const drvMap = getDriversSummary(drvSumMonth);
  const dEntries = Object.values(drvMap).sort((a, b) => b.settle - a.settle);

  const dsInHand = dEntries.reduce((s, x) => s + x.col + x.cust, 0);
  const dsDeduct = dEntries.reduce((s, x) => s + x.e + x.w, 0);
  const dsSettle = dEntries.reduce((s, x) => s + x.settle, 0);

  if ($("dsTotalDrivers")) {
    $("dsTotalDrivers").textContent = dEntries.filter(
      (x) => x.name !== "بدون سائق محدد"
    ).length;
  }
  if ($("dsTotalInHand")) $("dsTotalInHand").textContent = money(dsInHand);
  if ($("dsTotalDeduct")) $("dsTotalDeduct").textContent = money(dsDeduct);
  if ($("dsTotalSettle")) {
    $("dsTotalSettle").textContent = money(Math.abs(dsSettle));
    $("dsTotalSettle").className = "v " + (dsSettle >= 0 ? "greentxt" : "redtxt");
  }

  if ($("driverRows") && $("driverTotalsFoot")) {
    if (dEntries.length) {
      $("driverRows").innerHTML = dEntries
        .map((x) => {
          const inH = x.col + x.cust;
          return `<tr>
          <td><button class="linkbtn" onclick="openDriverAccount('${escJs(
            x.name
          )}','${escJs(drvSumMonth)}')">${esc(x.name)}</button></td>
          <td><strong>${x.n}</strong></td>
          <td>${money(x.col)}</td>
          <td class="bluetxt">${money(x.cust)}</td>
          <td><strong>${money(inH)}</strong></td>
          <td>${money(x.e)}</td>
          <td>${money(x.w)}</td>
          <td>${formatSettle(x.settle)}</td>
          <td><button class="light" onclick="openDriverAccount('${escJs(
            x.name
          )}','${escJs(drvSumMonth)}')">تصفية</button></td>
        </tr>`;
        })
        .join("");

      $("driverTotalsFoot").innerHTML = `<tr>
        <td>الإجمالي</td>
        <td>${dEntries.reduce((s, x) => s + x.n, 0)}</td>
        <td>${money(dEntries.reduce((s, x) => s + x.col, 0))}</td>
        <td class="bluetxt">${money(
          dEntries.reduce((s, x) => s + x.cust, 0)
        )}</td>
        <td>${money(dsInHand)}</td>
        <td>${money(dEntries.reduce((s, x) => s + x.e, 0))}</td>
        <td>${money(dEntries.reduce((s, x) => s + x.w, 0))}</td>
        <td>${formatSettle(dsSettle)}</td>
        <td></td>
      </tr>`;
    } else {
      $("driverRows").innerHTML =
        '<tr><td colspan="9" class="empty">لا توجد بيانات</td></tr>';
      $("driverTotalsFoot").innerHTML = "";
    }
  }

  renderDriverDetail();
}

function downloadFile(filename, content, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob(["\ufeff" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvRow(arr) {
  return arr.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

function exportCSV() {
  if (!isAdmin()) return;
  const headers = [
    "التاريخ",
    "السيارة",
    "السائق",
    "من",
    "إلى",
    "قيمة الرحلة",
    "حالة التحصيل",
    "المحصل",
    "العهدة",
    "بنزين",
    "بوابات",
    "تصاريح",
    "أخرى",
    "المصاريف",
    "أجرة السائق",
    "صافي التوريد",
    "صافي الربح",
    "ملاحظات",
  ];
  const rows = trips.map((t) =>
    csvRow([
      t.date,
      t.car,
      t.driver,
      t.from,
      t.to,
      t.fare,
      t.collection,
      t.collected,
      t.custody,
      t.fuel,
      t.tolls,
      t.permits,
      t.other,
      opExpenses(t),
      t.wage,
      driverSettle(t),
      carNet(t),
      t.notes,
    ])
  );
  downloadFile("forsan_trips.csv", [csvRow(headers), ...rows].join("\n"));
}

function exportCarsCSV() {
  if (!isAdmin()) return;
  const m = $("carsSummaryMonth")?.value || "";
  const entries = Object.values(getCarsSummary(m));
  const headers = [
    "السيارة",
    "عدد الرحلات",
    "قيمة الرحلات",
    "التحصيل",
    "المصاريف",
    "الأجور",
    "صافي الربح",
    "المتبقي",
  ];
  const rows = entries.map((x) =>
    csvRow([x.name, x.n, x.f, x.col, x.e, x.w, x.nt, x.d])
  );
  downloadFile(
    `forsan_cars_${m || "all"}.csv`,
    [csvRow(headers), ...rows].join("\n")
  );
}

function exportSingleCarCSV() {
  if (!isAdmin()) return;
  const chosen = $("carPicker")?.value || "";
  const m = $("carMonth")?.value || "";
  const list = trips.filter(
    (t) =>
      (!chosen || carName(t) === chosen) && (!m || (t.date || "").startsWith(m))
  );
  const headers = [
    "التاريخ",
    "السيارة",
    "السائق",
    "من",
    "إلى",
    "القيمة",
    "المحصل",
    "المصاريف",
    "الأجرة",
    "صافي الربح",
    "المتبقي",
    "ملاحظات",
  ];
  const rows = list.map((t) =>
    csvRow([
      t.date,
      carName(t),
      driverName(t),
      t.from,
      t.to,
      t.fare,
      t.collected,
      opExpenses(t),
      t.wage,
      carNet(t),
      due(t),
      t.notes,
    ])
  );
  downloadFile(
    `car_${chosen || "all"}_${m || "all"}.csv`,
    [csvRow(headers), ...rows].join("\n")
  );
}

function exportDriversCSV() {
  if (!isAdmin()) return;
  const m = $("driversSummaryMonth")?.value || "";
  const entries = Object.values(getDriversSummary(m));
  const headers = [
    "السائق",
    "الرحلات",
    "المحصل",
    "العهد",
    "المصاريف",
    "الأجور",
    "صافي التوريد",
  ];
  const rows = entries.map((x) =>
    csvRow([x.name, x.n, x.col, x.cust, x.e, x.w, x.settle])
  );
  downloadFile(
    `forsan_drivers_${m || "all"}.csv`,
    [csvRow(headers), ...rows].join("\n")
  );
}

function exportSingleDriverCSV() {
  if (!isAdmin()) return;
  const chosen = $("driverPicker")?.value || "";
  const m = $("driverMonth")?.value || "";
  const fromD = $("driverFromDate")?.value || "";
  const toD = $("driverToDate")?.value || "";
  const list = trips.filter((t) => {
    if (chosen && driverName(t) !== chosen) return false;
    if (m && !(t.date || "").startsWith(m)) return false;
    if (fromD && (t.date || "") < fromD) return false;
    if (toD && (t.date || "") > toD) return false;
    return true;
  });
  const headers = [
    "التاريخ",
    "السائق",
    "السيارة",
    "من",
    "إلى",
    "القيمة",
    "المحصل",
    "العهدة",
    "المصاريف",
    "الأجرة",
    "صافي التوريد",
    "ملاحظات",
  ];
  const rows = list.map((t) =>
    csvRow([
      t.date,
      driverName(t),
      carName(t),
      t.from,
      t.to,
      t.fare,
      t.collected,
      t.custody,
      opExpenses(t),
      t.wage,
      driverSettle(t),
      t.notes,
    ])
  );
  downloadFile(
    `driver_${chosen || "all"}.csv`,
    [csvRow(headers), ...rows].join("\n")
  );
}

function backup() {
  if (!isAdmin()) return;
  downloadFile(
    `forsan_backup_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(trips, null, 2),
    "application/json"
  );
}

function restore(e) {
  if (!isAdmin()) return;
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (ev) {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error("Invalid format");
      trips = imported;
      saveLocalTrips(trips);
      if (supabaseClient && trips.length) {
        const rows = trips.map((t) => ({
          id: String(t.id),
          date: t.date,
          car: t.car,
          driver: t.driver,
          from_loc: t.from,
          to_loc: t.to,
          fare: Number(t.fare) || 0,
          collection: t.collection,
          collected: Number(t.collected) || 0,
          custody: Number(t.custody) || 0,
          fuel: Number(t.fuel) || 0,
          tolls: Number(t.tolls) || 0,
          permits: Number(t.permits) || 0,
          other: Number(t.other) || 0,
          wage: Number(t.wage) || 0,
          notes: t.notes || "",
        }));
        await supabaseClient.from("trips").upsert(rows);
      }
      render();
      alert("تمت استعادة النسخة الاحتياطية بنجاح");
    } catch (err) {
      alert("تعذر قراءة ملف النسخة الاحتياطية");
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

function bindAuthForm() {
  $("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("authError");
    errBox?.classList.remove("show");

    const email = ($("loginEmail")?.value || "").trim();
    const password = $("loginPassword")?.value || "";

    if (!supabaseClient) {
      if (errBox) {
        errBox.textContent = "تعذر الاتصال بقاعدة البيانات السحابية";
        errBox.classList.add("show");
      }
      return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (errBox) {
        errBox.textContent = "بيانات الدخول غير صحيحة أو الحساب غير مفعل";
        errBox.classList.add("show");
      }
      return;
    }

    currentUser = data?.user || null;
    currentRole = await fetchUserRole(currentUser?.id, currentUser?.email);
    if (currentUser && currentRole !== "admin") {
      try {
        await supabaseClient
          .from("profiles")
          .upsert([{ id: currentUser.id, email: currentUser.email, role: "user" }], { onConflict: "id", ignoreDuplicates: true });
      } catch (e) {
        console.warn("Profile sync warning:", e);
      }
    }
    $("authModal")?.classList.add("hidden");
    applyRolePermissions();
    await loadTrips();
  });
}

function bindEvents() {
  bindAuthForm();

  [
    "fare",
    "collected",
    "custody",
    "fuel",
    "tolls",
    "permits",
    "other",
    "wage",
  ].forEach((id) => $(id)?.addEventListener("input", updateCalc));

  $("collection")?.addEventListener("change", () => {
    if (!$("collection") || !$("collected")) return;
    if ($("collection").value === "بدون تحصيل") $("collected").value = 0;
    else if ($("collection").value === "تم التحصيل" && $("fare")) {
      $("collected").value = $("fare").value;
    }
    updateCalc();
  });

  $("fare")?.addEventListener("input", () => {
    if ($("collection")?.value === "تم التحصيل" && $("collected")) {
      $("collected").value = $("fare").value;
    }
    updateCalc();
  });

  $("tripForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (supabaseClient && !currentUser) {
      $("authModal")?.classList.remove("hidden");
      return;
    }

    const f = num("fare"),
      c = num("collected");
    let colStatus = $("collection")?.value || "تم التحصيل";
    if (c > f && colStatus !== "تحصيل زائد") colStatus = "تحصيل زائد";

    const t = {
      id: isAdmin() && $("editId")?.value ? $("editId").value : String(Date.now()),
      date: $("date")?.value || "",
      car: ($("car")?.value || "").trim(),
      driver: ($("driver")?.value || "").trim(),
      from: ($("from")?.value || "").trim(),
      to: ($("to")?.value || "").trim(),
      fare: f,
      collection: colStatus,
      collected: c,
      custody: isAdmin() ? num("custody") : 0,
      fuel: num("fuel"),
      tolls: num("tolls"),
      permits: num("permits"),
      other: num("other"),
      wage: isAdmin() ? num("wage") : 0,
      notes: ($("notes")?.value || "").trim(),
    };

    const i = trips.findIndex((x) => x.id === t.id);
    if (i >= 0) trips[i] = t;
    else trips.unshift(t);

    await persist(t);
    resetForm();
    showSection("dashboard");
  });

  ["search", "monthFilter", "collectionFilter"].forEach((id) =>
    $(id)?.addEventListener("input", render)
  );
  $("carsSummaryMonth")?.addEventListener("change", render);
  $("driversSummaryMonth")?.addEventListener("change", render);
  ["carPicker", "carMonth"].forEach((id) =>
    $(id)?.addEventListener("change", renderCarDetail)
  );
  ["driverPicker", "driverFromDate", "driverToDate", "driverMonth"].forEach(
    (id) => $(id)?.addEventListener("change", renderDriverDetail)
  );
}

function startApp() {
  bindEvents();
  resetForm();
  initAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
