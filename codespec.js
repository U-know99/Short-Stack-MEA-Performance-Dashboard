/* ============================================================
 * codespec.js - 소재 코드 & 조립 사양 페이지
 *
 * (1) R&D 소재 코드 체계: 코드 빌더 + 자동 해석(parseCode)
 * (2) 스택 조립 사양 기록표: 작성 · 저장 · Word 내보내기
 *     - Layer 설계에서 부품 코드/치수 불러오기
 *
 * 코드 형식
 *   EP-두께-Column          예) EP-10T-6C
 *   CP/BP-두께-Groove-Design 예) BP-3T-2G-2L, BP-1T-NG-SQ
 *   GK-Design               예) GK-2L
 *   MEA-업체-면적           예) MEA-BNT-120
 *   PTL-업체-두께-구조-[P]-[M] 예) PTL-LTM-250-S, PTL-BEK-350-F-P-M
 *   GDL-두께-[CS]           예) GDL-350-CS
 * ============================================================ */
(function () {
  "use strict";

  /* ---------------- 코드 사전 ---------------- */
  const VENDOR_MEA = { TCS:"더카본스튜디오", BNT:"비나텍", HMT:"HEMT", WSP:"웨스피", BYS:"보야스에너지" };
  const VENDOR_PTL = { LTM:"LT메탈", ENR:"에너리치", BEK:"베카르트" };
  const GROOVE = { "2G":{um:200,label:"0.2T Groove"}, "4G":{um:400,label:"0.4T Groove"}, "6G":{um:600,label:"0.6T Groove"}, "NG":{um:0,label:"No Groove"} };
  const DESIGN = { "2L":"2 Line", "FG":"면 Groove", "SQ":"네모개구리", "TR":"세모개구리", "NG":"No Groove" };
  const PTL_STRUCT = { F:"Felt", S:"Sintered" };
  const COATING = { P:"Pt coating", M:"MPL coating" };
  const GDL_TYPE = { CS:"CS Type" };

  /** 두께 토큰 → μm. "3T"/"1.5T"=mm×1000, "250"=μm */
  function thToUm(tok) {
    if (tok == null) return null;
    const s = String(tok).trim().toUpperCase();
    if (s.endsWith("T")) { const v = parseFloat(s.slice(0, -1)); return Number.isFinite(v) ? Math.round(v * 1000) : null; }
    const v = parseFloat(s); return Number.isFinite(v) ? Math.round(v) : null;
  }
  const umToMm = (um) => Number((um / 1000).toFixed(3));

  /* ============================================================
   * 코드 해석기 (parseCode) - 외부 공개
   * ============================================================ */
  function parseCode(code) {
    if (!code || typeof code !== "string") return { ok: false };
    const t = code.trim().toUpperCase().split("-").map((x) => x.trim()).filter(Boolean);
    if (!t.length) return { ok: false };
    const type = t[0];
    const out = { ok: true, type, code: code.trim().toUpperCase(), specs: {} };

    try {
      if (type === "EP") {
        const um = thToUm(t[1]); const col = t[2] ? parseInt(t[2]) : null;
        out.label = "End Plate";
        out.specs = { thicknessUm: um, columns: Number.isFinite(col) ? col : null };
        out.desc = `${um != null ? umToMm(um) + " mm" : "?"}${col ? " / " + col + " Column" : ""} End Plate`;
      } else if (type === "CP" || type === "BP") {
        const um = thToUm(t[1]); const g = GROOVE[t[2]]; const design = DESIGN[t[3]];
        out.label = type === "BP" ? "Bipolar Plate" : "Current Plate";
        out.specs = { thicknessUm: um, grooveUm: g ? g.um : null, design: t[3] || null };
        out.desc = `${um != null ? umToMm(um) + " mm" : "?"} / ${g ? g.label : (t[2]||"?")} / ${design || t[3] || "?"}`;
      } else if (type === "GK") {
        out.label = "Gasket";
        out.specs = { design: t[1] || null };
        out.desc = `Gasket / ${DESIGN[t[1]] || t[1] || "?"}`;
      } else if (type === "MEA") {
        const vendor = VENDOR_MEA[t[1]] || t[1]; const area = t[2] ? parseFloat(t[2]) : null;
        out.label = "MEA";
        out.specs = { vendor, vendorCode: t[1], areaCm2: Number.isFinite(area) ? area : null };
        out.desc = `${vendor || "?"} / ${area ? area + " cm²" : "?"}`;
      } else if (type === "PTL") {
        const vendor = VENDOR_PTL[t[1]] || t[1]; const um = thToUm(t[2]);
        const struct = PTL_STRUCT[t[3]] || t[3];
        const flags = t.slice(4).map((x) => COATING[x]).filter(Boolean);
        out.label = "PTL";
        out.specs = { vendor, vendorCode: t[1], thicknessUm: um, structure: t[3] || null, coatings: t.slice(4) };
        out.desc = `${vendor || "?"} / ${um != null ? um + " μm" : "?"} / ${struct || "?"}${flags.length ? " / " + flags.join(" + ") : ""}`;
      } else if (type === "GDL") {
        const um = thToUm(t[1]); const typ = t[2] ? (GDL_TYPE[t[2]] || t[2]) : "일반 타입";
        out.label = "GDL";
        out.specs = { thicknessUm: um, gdlType: t[2] || null };
        out.desc = `${um != null ? um + " μm" : "?"} / ${typ}`;
      } else {
        return { ok: false, type, code };
      }
    } catch (e) { return { ok: false, type, code }; }
    return out;
  }

  /* ============================================================
   * 코드 빌더 UI (좌측)
   * ============================================================ */
  // 종류별 입력 필드 정의
  //  type: combo(자주쓰는값 select + 직접입력) / sel(GROOVE) / selD(DESIGN) / selV(업체) / selP(구조) / chk
  const BUILDER = {
    EP: [ {k:"th",label:"두께",type:"combo",list:["10T","6T"],def:"10T"}, {k:"col",label:"Column 수",type:"combo",list:["6C","4C","1C"],def:"6C"} ],
    CP: [ {k:"th",label:"두께",type:"combo",list:["3T","1.5T","1T"],def:"3T"}, {k:"groove",label:"Groove",type:"sel",opts:GROOVE,def:"2G"}, {k:"design",label:"설계 구조",type:"selD",opts:DESIGN,def:"2L"} ],
    BP: [ {k:"th",label:"두께",type:"combo",list:["3T","1.5T","1T"],def:"3T"}, {k:"groove",label:"Groove",type:"sel",opts:GROOVE,def:"2G"}, {k:"design",label:"설계 구조",type:"selD",opts:DESIGN,def:"2L"} ],
    GK: [ {k:"design",label:"설계 구조",type:"selD",opts:DESIGN,def:"2L"} ],
    MEA:[ {k:"vendor",label:"업체",type:"selV",opts:VENDOR_MEA,def:"TCS"}, {k:"area",label:"면적(cm²)",type:"combo",list:["100","120"],def:"100"} ],
    PTL:[ {k:"vendor",label:"업체",type:"selV",opts:VENDOR_PTL,def:"LTM"}, {k:"th",label:"두께(μm)",type:"combo",list:["350","250","500"],def:"350"}, {k:"struct",label:"구조",type:"selP",opts:PTL_STRUCT,def:"F"}, {k:"pt",label:"Pt coating",type:"chk"}, {k:"mpl",label:"MPL coating",type:"chk"} ],
    GDL:[ {k:"th",label:"두께(μm)",type:"combo",list:["150","200","250","350","500"],def:"350"}, {k:"cs",label:"CS Type",type:"chk"} ],
  };

  function optionsHtml(opts, def) {
    return Object.entries(opts).map(([c, v]) =>
      `<option value="${c}" ${c === def ? "selected" : ""}>${c} — ${typeof v === "object" ? v.label : v}</option>`).join("");
  }
  // 콤보(select + 직접입력) 필드 HTML
  function comboHtml(f) {
    const opts = f.list.map((v) => `<option value="${v}" ${v === f.def ? "selected" : ""}>${v}</option>`).join("");
    return `<div class="meta-field cb-combo"><label>${f.label}</label>
      <div class="combo-wrap">
        <select data-k="${f.k}" data-combo="1">${opts}<option value="__C">직접입력…</option></select>
        <input type="text" data-k="${f.k}__c" class="combo-custom" placeholder="직접입력" hidden />
      </div></div>`;
  }

  const CodeSpec = {
    _init: false,

    init() {
      if (this._init) return; this._init = true;
      // 코드 빌더
      document.getElementById("cbType").addEventListener("change", () => this.renderBuilder());
      document.getElementById("cbFields").addEventListener("input", () => this.updateCode());
      document.getElementById("cbFields").addEventListener("change", () => this.updateCode());
      document.getElementById("cbAdd").addEventListener("click", () => this.addMaterial());
      // 소재 목록 Excel 내보내기 / 삭제(위임)
      document.getElementById("matExcel").addEventListener("click", () => this.exportMaterialsExcel());
      document.getElementById("matTables").addEventListener("click", (e) => {
        const del = e.target.closest(".mat-del");
        if (del) this.removeMaterial(del.dataset.id);
      });
      // 조립 사양
      this._bindAssembly();
    },

    /** 소재 목록 배열 (없으면 생성) */
    materials() {
      if (!Array.isArray(Storage.state.materials)) Storage.state.materials = [];
      return Storage.state.materials;
    },

    /** 페이지 진입 시 */
    refresh() {
      this.init();
      this.renderBuilder();
      this.renderMatTables();
      this.loadAssembly();
    },

    /* ---------------- 소재 목록 등록/표 ---------------- */

    addMaterial() {
      const code = document.getElementById("cbCode").textContent.trim();
      const dec = parseCode(code);
      if (!dec.ok) { Utils.toast("코드 형식을 확인하세요: " + code); return; }
      // 같은 코드 중복 방지
      if (this.materials().some((m) => m.code === dec.code)) {
        Utils.toast("이미 등록된 코드입니다: " + dec.code);
        return;
      }
      const note = document.getElementById("cbNote").value.trim();
      this.materials().push({
        id: Utils.uid("mat"), type: dec.type, code: dec.code,
        desc: dec.desc, specs: dec.specs, note,
      });
      Storage.save();
      document.getElementById("cbNote").value = "";
      this.renderMatTables();
      Utils.toast(`목록에 추가: ${dec.code}`);
    },

    removeMaterial(id) {
      Storage.state.materials = this.materials().filter((m) => m.id !== id);
      Storage.save();
      this.renderMatTables();
    },

    /** 종류별 표 컬럼 정의 (specs 키 → 표시) */
    _matColumns(type) {
      const um = (v) => (v != null ? (v >= 1000 ? (v / 1000) + " mm" : v + " μm") : "");
      const grooveT = (v) => (v != null ? (v === 0 ? "No Groove" : (v / 1000) + "T") : "");
      const designName = { "2L":"2 Line","FG":"면 Groove","SQ":"네모개구리","TR":"세모개구리","NG":"No Groove" };
      const map = {
        EP:  [["두께", s=>um(s.thicknessUm)], ["Column", s=>s.columns!=null?s.columns+"C":""]],
        CP:  [["두께", s=>um(s.thicknessUm)], ["Groove", s=>grooveT(s.grooveUm)], ["설계", s=>designName[s.design]||s.design||""]],
        BP:  [["두께", s=>um(s.thicknessUm)], ["Groove", s=>grooveT(s.grooveUm)], ["설계", s=>designName[s.design]||s.design||""]],
        GK:  [["설계 구조", s=>designName[s.design]||s.design||""]],
        MEA: [["업체", s=>s.vendor||""], ["면적", s=>s.areaCm2!=null?s.areaCm2+" cm²":""]],
        PTL: [["업체", s=>s.vendor||""], ["두께", s=>um(s.thicknessUm)], ["구조", s=>({F:"Felt",S:"Sintered"}[s.structure]||s.structure||"")],
              ["코팅", s=>(s.coatings||[]).map(c=>({P:"Pt",M:"MPL"}[c]||c)).join("+")]],
        GDL: [["두께", s=>um(s.thicknessUm)], ["타입", s=>s.gdlType?"CS Type":"일반"]],
      };
      return map[type] || [];
    },

    renderMatTables() {
      const box = document.getElementById("matTables");
      const mats = this.materials();
      // 표시 순서 (CP/BP는 함께)
      const order = [["EP","End Plate"],["BP","Current / Bipolar Plate"],["GK","Gasket"],["MEA","MEA"],["PTL","PTL"],["GDL","GDL"]];
      let html = "";
      for (const [type, title] of order) {
        const types = type === "BP" ? ["CP","BP"] : [type];
        const rows = mats.filter((m) => types.includes(m.type));
        if (!rows.length) continue;
        const cols = this._matColumns(type === "BP" ? "BP" : type);
        html += `<div class="mat-block">
          <div class="mat-block-title"><i class="bi bi-box-seam"></i> ${title} <span class="mat-count">${rows.length}</span></div>
          <div class="table-wrap"><table class="mat-table">
            <thead><tr><th>코드</th>${type==="BP"?"<th>구분</th>":""}${cols.map(c=>`<th>${c[0]}</th>`).join("")}<th>메모</th><th></th></tr></thead>
            <tbody>${rows.map((m)=>`<tr>
              <td class="mat-code">${m.code}</td>
              ${type==="BP"?`<td>${m.type}</td>`:""}
              ${cols.map(c=>`<td>${c[1](m.specs||{})||"—"}</td>`).join("")}
              <td class="mat-note">${m.note||""}</td>
              <td><button class="mat-del" data-id="${m.id}" title="삭제"><i class="bi bi-x-lg"></i></button></td>
            </tr>`).join("")}</tbody>
          </table></div>
        </div>`;
      }
      box.innerHTML = html || `<p class="empty-msg">위에서 코드를 만들어 “목록 추가”를 누르면 소재별 표가 생성됩니다.</p>`;
    },

    /** 소재 목록을 Excel(xlsx) 로 내보내기 — 종류별 시트 */
    exportMaterialsExcel() {
      if (typeof XLSX === "undefined") { Utils.toast("⚠ Excel 라이브러리를 찾을 수 없습니다."); return; }
      const mats = this.materials();
      if (!mats.length) { Utils.toast("등록된 소재가 없습니다."); return; }
      const wb = XLSX.utils.book_new();
      const sheets = [["EP","EP"],["CPBP","CP·BP"],["GK","Gasket"],["MEA","MEA"],["PTL","PTL"],["GDL","GDL"]];
      const groupOf = (t) => (t === "CP" || t === "BP") ? "CPBP" : t;
      let any = false;
      sheets.forEach(([key, name]) => {
        const rows = mats.filter((m) => groupOf(m.type) === key);
        if (!rows.length) return;
        const cols = this._matColumns(key === "CPBP" ? "BP" : key);
        const header = ["코드", ...(key === "CPBP" ? ["구분"] : []), ...cols.map(c=>c[0]), "메모"];
        const data = rows.map((m) => [m.code, ...(key==="CPBP"?[m.type]:[]), ...cols.map(c=>c[1](m.specs||{})), m.note||""]);
        const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
        ws["!cols"] = header.map(() => ({ wch: 16 }));
        XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g,"_").slice(0,31));
        any = true;
      });
      // 전체 시트
      const allHeader = ["종류","코드","사양(해석)","메모"];
      const allData = mats.map((m)=>[m.type, m.code, m.desc||"", m.note||""]);
      const wsAll = XLSX.utils.aoa_to_sheet([allHeader, ...allData]);
      wsAll["!cols"] = [{wch:8},{wch:22},{wch:40},{wch:20}];
      XLSX.utils.book_append_sheet(wb, wsAll, "전체");
      XLSX.writeFile(wb, `소재목록_${Utils.fileTimestamp()}.xlsx`);
      Utils.toast(`소재 목록을 Excel로 내보냈습니다. (${mats.length}종)`);
    },

    /* ---------------- 코드 빌더 ---------------- */
    renderBuilder() {
      const type = document.getElementById("cbType").value;
      const box = document.getElementById("cbFields");
      box.innerHTML = (BUILDER[type] || []).map((f) => {
        if (f.type === "chk")
          return `<label class="cb-chk"><input type="checkbox" data-k="${f.k}" /> ${f.label}</label>`;
        if (f.type === "combo") return comboHtml(f);
        if (f.type === "text")
          return `<div class="meta-field"><label>${f.label}</label><input type="text" data-k="${f.k}" value="${f.def||""}" placeholder="${f.ph||""}" /></div>`;
        // select 종류 (opts 객체)
        return `<div class="meta-field"><label>${f.label}</label><select data-k="${f.k}">${optionsHtml(f.opts, f.def)}</select></div>`;
      }).join("");
      // 콤보 "직접입력" 토글
      box.querySelectorAll('select[data-combo]').forEach((sel) => {
        sel.addEventListener("change", () => {
          const ci = box.querySelector(`[data-k="${sel.dataset.k}__c"]`);
          if (ci) { ci.hidden = sel.value !== "__C"; if (sel.value === "__C") ci.focus(); }
        });
      });
      this.updateCode();
    },

    updateCode() {
      const type = document.getElementById("cbType").value;
      const box = document.getElementById("cbFields");
      const get = (k) => box.querySelector(`[data-k="${k}"]`);
      const val = (k) => {
        const el = get(k);
        if (!el) return "";
        if (el.type === "checkbox") return el.checked;
        // 콤보: "직접입력" 이면 커스텀 입력값 사용
        if (el.dataset.combo && el.value === "__C") {
          const ci = get(k + "__c"); return ci ? ci.value.trim().toUpperCase() : "";
        }
        return el.value.trim().toUpperCase();
      };
      let parts = [type];
      if (type === "EP") parts.push(val("th"), val("col"));
      else if (type === "CP" || type === "BP") parts.push(val("th"), val("groove"), val("design"));
      else if (type === "GK") parts.push(val("design"));
      else if (type === "MEA") parts.push(val("vendor"), val("area"));
      else if (type === "PTL") { parts.push(val("vendor"), val("th"), val("struct")); if (val("pt")) parts.push("P"); if (val("mpl")) parts.push("M"); }
      else if (type === "GDL") { parts.push(val("th")); if (val("cs")) parts.push("CS"); }
      const code = parts.filter((x) => x !== "" && x !== false).join("-");
      document.getElementById("cbCode").textContent = code;
      const dec = parseCode(code);
      document.getElementById("cbDecode").textContent = dec.ok ? "→ " + dec.desc : "";
    },

    renderRefTable() {
      const rows = [
        ["End Plate", "EP-두께-Column", "EP-10T-6C"],
        ["Current Plate", "CP-두께-Groove-Design", "CP-3T-2G-2L"],
        ["Bipolar Plate", "BP-두께-Groove-Design", "BP-1.5T-4G-SQ"],
        ["Gasket", "GK-Design", "GK-2L"],
        ["MEA", "MEA-업체-면적", "MEA-BNT-120"],
        ["PTL", "PTL-업체-두께-구조-[P]-[M]", "PTL-BEK-350-F-P-M"],
        ["GDL", "GDL-두께-[CS]", "GDL-350-CS"],
      ];
      document.getElementById("codeRefBody").innerHTML = rows.map((r) =>
        `<tr><td>${r[0]}</td><td><code>${r[1]}</code></td><td><code>${r[2]}</code></td></tr>`).join("");
    },

    /* ============================================================
     * 조립 사양 기록표
     * ============================================================ */
    // 부품 목록 (CCM 은 코드 미해석 - MEA 에 포함되는 자유 입력)
    PARTS: [
      {k:"EP",label:"EP (End Plate)"}, {k:"CP",label:"CP (Current Plate)"},
      {k:"BP",label:"BP (Bipolar Plate)"}, {k:"GK",label:"Gasket"},
      {k:"MEA",label:"MEA"}, {k:"PTL",label:"PTL"},
      {k:"CCM",label:"CCM",free:true}, {k:"GDL",label:"GDL"},
    ],

    _bindAssembly() {
      // 부품 입력칸 생성
      document.getElementById("asmParts").innerHTML = this.PARTS.map((p) => `
        <div class="asm-part">
          <label>${p.label}</label>
          <input type="text" data-part="${p.k}" placeholder="${p.free ? "자유 입력" : p.k + "-..."}" />
          ${p.free ? "" : `<span class="asm-decode" data-decode="${p.k}"></span>`}
        </div>`).join("");
      // 코드 입력 → 해석 표시
      document.getElementById("asmParts").addEventListener("input", (e) => {
        const inp = e.target.closest("input[data-part]");
        if (!inp) return;
        const p = this.PARTS.find((x) => x.k === inp.dataset.part);
        if (p && !p.free) {
          const dec = parseCode(inp.value);
          const el = document.querySelector(`[data-decode="${p.k}"]`);
          if (el) { el.textContent = inp.value.trim() ? (dec.ok ? "✓ " + dec.desc : "⚠ 형식 확인") : ""; el.className = "asm-decode " + (inp.value.trim() ? (dec.ok ? "ok" : "warn") : ""); }
        }
      });

      // 체결 조건 행 추가
      document.getElementById("asmFastenAdd").addEventListener("click", () => this.addFastenRow());
      document.getElementById("asmFastenBody").addEventListener("click", (e) => {
        if (e.target.closest(".fasten-del")) e.target.closest("tr").remove();
      });

      // Layer 불러오기 / 저장 / Word
      document.getElementById("asmLoadLayer").addEventListener("click", () => this.loadFromLayer());
      document.getElementById("asmSave").addEventListener("click", () => this.saveAssembly());
      document.getElementById("asmWord").addEventListener("click", () => this.exportWord());
    },

    addFastenRow(v = {}) {
      const tb = document.getElementById("asmFastenBody");
      const tr = document.createElement("tr");
      tr.innerHTML = ["p","a","b","c","d"].map((k) =>
        `<td><input type="text" data-f="${k}" value="${v[k] ?? ""}" /></td>`).join("") +
        `<td><button class="fasten-del" title="행 삭제"><i class="bi bi-x-lg"></i></button></td>`;
      tb.appendChild(tr);
    },

    /** 화면 → 데이터 객체 */
    collect() {
      const g = (id) => document.getElementById(id).value.trim();
      const parts = {};
      this.PARTS.forEach((p) => { parts[p.k] = document.querySelector(`input[data-part="${p.k}"]`).value.trim(); });
      const fasten = [...document.querySelectorAll("#asmFastenBody tr")].map((tr) => {
        const o = {}; tr.querySelectorAll("input[data-f]").forEach((i) => o[i.dataset.f] = i.value.trim());
        return o;
      }).filter((o) => Object.values(o).some((v) => v));
      return {
        stackId: g("asmStackId"), date: g("asmDate"), area: g("asmArea"), targetT: g("asmTargetT"),
        col: g("asmCol"), layer: g("asmLayer"), cellTotal: g("asmCellTotal"),
        parts, fasten, notes: document.getElementById("asmNotes").value.trim(),
      };
    },

    /** 데이터 → 화면 */
    fill(a) {
      const s = (id, v) => { document.getElementById(id).value = v ?? ""; };
      s("asmStackId", a.stackId); s("asmDate", a.date); s("asmArea", a.area); s("asmTargetT", a.targetT);
      s("asmCol", a.col); s("asmLayer", a.layer); s("asmCellTotal", a.cellTotal);
      s("asmNotes", a.notes);
      this.PARTS.forEach((p) => {
        const inp = document.querySelector(`input[data-part="${p.k}"]`);
        if (inp) { inp.value = a.parts?.[p.k] || ""; inp.dispatchEvent(new Event("input", { bubbles: true })); }
      });
      const tb = document.getElementById("asmFastenBody"); tb.innerHTML = "";
      (a.fasten && a.fasten.length ? a.fasten : [{},{},{}]).forEach((r) => this.addFastenRow(r));
    },

    loadAssembly() {
      const a = Storage.state.assembly;
      if (a) this.fill(a);
      else this.fill({ fasten: [{},{},{}] });
    },

    saveAssembly() {
      Storage.state.assembly = this.collect();
      Storage.save();
      Utils.toast("조립 사양을 저장했습니다.");
    },

    /** Layer 설계에서 면적·목표두께·부품 코드 불러오기 */
    loadFromLayer() {
      const mea = Storage.getSelectedMea();
      if (!mea) { Utils.toast("성능평가 페이지에서 MEA를 먼저 선택하세요."); return; }
      const hint = (window.LayerDesign && LayerDesign.getAssemblyHints) ? LayerDesign.getAssemblyHints() : {};
      const s = (id, v) => { if (v != null && v !== "") document.getElementById(id).value = v; };
      s("asmArea", hint.area ?? mea.specs?.activeArea);
      s("asmTargetT", hint.targetText);
      s("asmCellTotal", hint.cellTotal ?? mea.conditions?.cellCount);
      s("asmLayer", hint.cellTotal ?? mea.conditions?.cellCount);
      // 부품 코드 채우기 (있는 것만)
      const setPart = (k, v) => { if (!v) return; const i = document.querySelector(`input[data-part="${k}"]`); i.value = v; i.dispatchEvent(new Event("input",{bubbles:true})); };
      setPart("BP", hint.bpCode);
      setPart("GK", hint.gkCode);
      setPart("PTL", hint.ptlCode);
      setPart("GDL", hint.gdlCode);
      // MEA 코드 자동 생성 (업체+면적)
      const vcode = Object.keys(VENDOR_MEA).find((c) => VENDOR_MEA[c] === (mea.specs?.vendor || ""));
      if (vcode && mea.specs?.activeArea) setPart("MEA", `MEA-${vcode}-${mea.specs.activeArea}`);
      Utils.toast(`'${mea.name}' Layer 설계에서 불러왔습니다.`);
    },

    /* ---------------- Word 내보내기 (.doc = Word 호환 HTML) ---------------- */
    exportWord() {
      const a = this.collect();
      const dec = (k) => { const d = parseCode(a.parts[k]); return d.ok ? d.desc : ""; };
      const row2 = (l1,v1,l2,v2) => `<tr><th>${l1}</th><td>${v1||""}</td><th>${l2}</th><td>${v2||""}</td></tr>`;
      const partCell = (k) => `${a.parts[k]||""}${!this.PARTS.find(p=>p.k===k).free && a.parts[k] ? `<div class="dc">${dec(k)}</div>`:""}`;
      const fastenRows = (a.fasten.length?a.fasten:[{}]).map((f)=>
        `<tr><td>${f.p||""}</td><td>${f.a||""}</td><td>${f.b||""}</td><td>${f.c||""}</td><td>${f.d||""}</td></tr>`).join("");

      const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
      <style>
        body{font-family:'Malgun Gothic',sans-serif;font-size:11pt;color:#111}
        h1{font-size:15pt;color:#1f3b63;border-bottom:2px solid #1e6ed4;padding-bottom:4px}
        h2{font-size:12pt;color:#1e6ed4;margin:14px 0 4px}
        table{border-collapse:collapse;width:100%;margin:4px 0 10px}
        th,td{border:1px solid #99a;padding:5px 8px;font-size:10.5pt;vertical-align:top}
        th{background:#1f3b63;color:#fff;text-align:left;width:16%}
        .parts th{width:12%} .dc{color:#666;font-size:9pt;margin-top:2px}
        .fasten th{background:#31507a;text-align:center;width:20%}
        .fasten td{text-align:center}
      </style></head><body>
      <h1>Stack Assembly Specification</h1>
      <table>
        ${row2("스택 ID", a.stackId, "스택 제작일", a.date)}
        ${row2("활성면적", a.area?a.area+" cm²":"", "목표 두께(압축률)", a.targetT)}
        <tr><th>셀수</th><td colspan="3">Column수: ${a.col||""} / Layer수: ${a.layer||""} / 총: ${a.cellTotal||""}</td></tr>
      </table>
      <h2>부품</h2>
      <table class="parts">
        <tr><th>EP</th><td>${partCell("EP")}</td><th>CP</th><td>${partCell("CP")}</td></tr>
        <tr><th>BP</th><td>${partCell("BP")}</td><th>Gasket</th><td>${partCell("GK")}</td></tr>
        <tr><th>MEA</th><td>${partCell("MEA")}</td><th>PTL</th><td>${partCell("PTL")}</td></tr>
        <tr><th>CCM</th><td>${partCell("CCM")}</td><th>GDL</th><td>${partCell("GDL")}</td></tr>
      </table>
      <h2>체결 조건</h2>
      <table class="fasten"><tr><th>압력</th><th>a</th><th>b</th><th>c</th><th>d</th></tr>${fastenRows}</table>
      <h2>특이사항</h2>
      <table><tr><td style="height:60px">${(a.notes||"").replace(/\n/g,"<br>")}</td></tr></table>
      </body></html>`;

      const blob = new Blob(["﻿" + html], { type: "application/msword" });
      const name = (a.stackId || "조립사양").replace(/[\\/:*?"<>|]/g, "_");
      Utils.downloadBlob(blob, `${name}_${Utils.fileTimestamp()}.doc`);
      Utils.toast("Word(.doc)로 내보냈습니다.");
    },
  };

  // 페이지 진입 시 갱신
  document.addEventListener("page:changed", (e) => {
    if (e.detail.page === "page-code") {
      try { CodeSpec.refresh(); } catch (err) { console.error("[CodeSpec] 갱신 실패:", err); }
    }
  });

  // 외부 공개
  window.CodeSpec = CodeSpec;
  window.parseCode = parseCode;
})();
