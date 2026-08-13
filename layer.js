/* ============================================================
 * layer.js - PEM Cell Layer Designer
 *
 * PEM 수전해 셀의 층간 구조를 설계하는 엔지니어링 도구.
 *
 * [조립 구조] (단면도는 실제 조립 상태로 그린다)
 * - Gasket 은 BP 의 Groove 홈에 "실제로 파인" 형태로 삽입된다.
 *   BP 는 홈이 절단된 path 로 그려지므로 가스켓과 판재가 겹치지 않는다.
 * - Sub Gasket 은 Gasket 과 CCM 사이에서 Membrane 양끝을 잡는다.
 * - Mesh / PTL / GDL 은 프레임 개구부 "안쪽"에 들어간다.
 * - Catalyst 는 Sub Gasket 개구부 안 중앙에서 Membrane 위에 놓인다.
 *
 * [기하 모델 - 두 개의 병렬 경로]
 * BP 안쪽 면과 CCM 사이에는 서로 독립적인 두 경로가 나란히 존재한다.
 *
 *   프레임 경로 (실링) : Gasket → Sub Gasket   (개구부가 있는 링 형상)
 *   전극 경로 (활성부) : Mesh → PTL → …        (개구부 안쪽 판 형상)
 *
 * 각 경로 안에서는 층을 빈틈없이 맞붙여 쌓으므로 겹침도 공중부양도
 * 발생하지 않는다. 두 경로의 높이가 다르면 그 차이(delta)를 임의로
 * 숨기지 않고 "공극" 또는 "간섭" 밴드로 명시한다.
 *
 *   need  = frameH − catTh        전극 경로가 채워야 하는 높이
 *   delta = elecH − need
 *     delta < 0 → 공극 : 체결해도 전극이 CCM 에 닿지 않는다 (접촉 불량)
 *     delta > 0 → 간섭 : 가스켓이 그만큼 압축되어야 조립된다
 *
 * [보기 모드]
 * - 비압축(free)    : 부품 공칭 치수 그대로. 불일치는 밴드로 표시.
 * - 체결(clamped)   : delta > 0 이면 가스켓을 delta 만큼 압축시켜 그린다.
 *                     delta < 0 이면 압축으로 메울 수 없으므로 공극 유지.
 *
 * [핵심 원칙]
 * - SVG 세로 방향은 실제 두께 비율 그대로 (최소 높이 보정 없음).
 *   → 80μm Membrane 은 실제로 얇게 그려진다.
 * - 가로 방향은 폭(mm) 비율.
 * - Cell Pitch = 조립 기하 높이 (BP + 조립높이(A) + Membrane + 조립높이(C) + BP)
 *   층 두께 단순 합은 참고값으로만 병기한다. 가스켓과 전극은 병렬 경로여서
 *   단순히 더하면 실제보다 두꺼워지기 때문이다.
 * - 내부 계산은 전부 μm. 입력 자동 인식: 10 미만 = mm, 10 이상 = μm.
 *
 * 데이터: mea.cellDesign (MEA 별 자동 저장, JSON 백업 포함)
 * ============================================================ */
(function () {
  "use strict";

  /* ---------------- 기본 설계값 ---------------- */

  /** 슬롯별 기본값 (th: μm, w/opening/outer: mm) */
  function defaultDesign() {
    return {
      v: 6, // 설계 스키마 버전
      symmetry: true,
      compression: 0,   // 전역 가스켓 압축률(%) - Anode/Cathode 동일
      // BP 표시 높이 (표시 전용, 계산에는 영향 없음)
      // "min" = 고정 높이로 확 줄임 / "half" = 실비율의 절반 / "full" = 실비율
      bpView: "min",
      order: ["bpA", "gasketA", "meshA", "feltA", "ptlA", "subA", "catA",
              "mem", "catC", "subC", "gdlC", "ptlC", "gasketC", "meshC", "bpC"],
      hidden: {},
      slots: {
        bpA:     { th: 3000, groove: 200, w: 70 },
        // Mesh 는 BP 면에 붙고 눌리지 않는 강체
        meshA:   { th: 550, w: 61, anchor: "bp", rigid: true },
        // Anode: felt PTL(50mm) 위에 sintered PTL(57mm)
        feltA:   { label: "felt PTL", th: 350, w: 50, custom: true, anchor: "ccm", rigid: true },
        ptlA:    { kind: "PTL", ptlType: "Sintered", th: 350, w: 57, anchor: "ccm", rigid: true },
        // 가스켓만 눌린다. 개구부 66mm - 매쉬(61mm)와 가로 틈 존재
        gasketA: { th: 1500, opening: 66, outer: 70, rigid: false },
        // 서브가스켓은 막과 hot pressing 되어 있고 눌리지 않는다
        subA:    { th: 200, opening: 50, outer: 70, rigid: true },
        catA:    { th: 14, w: 50 },
        mem:     { th: 80, w: 60 },
        catC:    { th: 14, w: 50 },
        subC:    { th: 200, opening: 50, outer: 70, rigid: true },
        gasketC: { th: 1500, opening: 66, outer: 70, rigid: false },
        // Cathode: sintered PTL(57mm) 위에 GDL(50mm)
        ptlC:    { kind: "PTL", ptlType: "Sintered", th: 350, w: 57, anchor: "ccm", rigid: true },
        gdlC:    { label: "GDL", th: 180, w: 50, custom: true, anchor: "ccm", rigid: true },
        meshC:   { th: 550, w: 61, anchor: "bp", rigid: true },
        bpC:     { th: 3000, groove: 200, w: 70 },
      },
      targets: { pitch: 0, stackCount: 20 },
    };
  }

  /** 슬라이더가 허용하는 가스켓 압축률 상한 (%) - 실제 상한은 기하로 결정 */
  const MAX_GASKET_COMPRESSION = 50;
  /** BP "최소" 보기에서 판재에 할당하는 고정 높이(px) */
  const BP_MIN_PX = 26;

  /**
   * 슬롯 메타: 라벨/색상/대칭 짝
   * 색상: Sub Gasket=노랑, Membrane=옅은 회색, Catalyst(CCM)=짙은 회색,
   *       PTL=은색, Mesh=하늘색
   */
  const SLOT_META = {
    bpA:     { label: "Anode BP",           color: "#55606e", pair: "bpC" },
    meshA:   { label: "Mesh (A)",           color: "#8fc9f2", pair: "meshC" },
    ptlA:    { label: "PTL (A)"      ,        color: "#c6cad2", pair: "ptlC" },
    gasketA: { label: "Gasket (A)",         color: "#23272e", pair: "gasketC" },
    subA:    { label: "Sub Gasket (A)",     color: "#e6c229", pair: "subC" },
    catA:    { label: "Catalyst (Anode)",   color: "#111111", pair: "catC" },
    mem:     { label: "Membrane",           color: "#3a3f45", pair: null },
    catC:    { label: "Catalyst (Cathode)", color: "#111111", pair: "catA" },
    subC:    { label: "Sub Gasket (C)",     color: "#e6c229", pair: "subA" },
    gasketC: { label: "Gasket (C)",         color: "#23272e", pair: "gasketA" },
    ptlC:    { label: "PTL (C)"      ,        color: "#c6cad2", pair: "ptlA" },
    meshC:   { label: "Mesh (C)",           color: "#8fc9f2", pair: "meshA" },
    bpC:     { label: "Cathode BP",         color: "#55606e", pair: "bpA" },
  };

  const CUSTOM_COLOR = "#9aa3ad"; // 추가 층 기본 색 (은색 계열)

  /* ---------------- 층 분류 (기하 모델의 핵심) ----------------
   * bp   : 판재. 홈(groove)이 절단된 형태로 그려진다.
   * ccm  : Catalyst / Membrane. 셀 중앙 고정.
   * frame: 개구부(opening)를 가진 링 형상 - 실링 경로.
   * elec : 개구부 안쪽에 들어가는 판 형상 - 전극 경로.
   * 프레임과 전극은 나란히 놓인 별개의 경로이므로, 둘 사이의 순서를
   * 바꿔도 기하는 달라지지 않는다(물리적으로 옳다). 같은 경로 안에서의
   * 순서는 그대로 반영된다.
   */
  const BP_KEYS = ["bpA", "bpC"];
  const CCM_KEYS = ["catA", "mem", "catC"];

  function pathOf(key, slot) {
    if (BP_KEYS.includes(key)) return "bp";
    if (CCM_KEYS.includes(key)) return "ccm";
    if (slot && slot.opening !== undefined) return "frame";
    return "elec";
  }

  const PATH_LABEL = { bp: "판재", ccm: "CCM", frame: "프레임", elec: "전극" };
  const ANCHOR_LABEL = { bp: "BP측", ccm: "CCM측" };

  /**
   * 층이 눌리지 않는 강체인가.
   * 눌리는 것은 가스켓뿐이다. Mesh·PTL·GDL·Sub Gasket 은 모두 강체이며
   * PTL 은 두께가 줄지 않고 "휘어서" 공간을 메운다.
   */
  function isRigid(key, slot) {
    if (slot && slot.rigid !== undefined) return !!slot.rigid;
    const p = pathOf(key, slot);
    if (p === "frame") return /^sub/.test(key);  // Sub Gasket 은 강체, Gasket 만 눌림
    return true;                                // 전극(Mesh·PTL·GDL)은 전부 강체
  }

  /** 전극 층이 어느 면에 붙는가 ("bp" = BP 면 / "ccm" = 촉매면) */
  function anchorOf(key, slot) {
    if (slot && (slot.anchor === "bp" || slot.anchor === "ccm")) return slot.anchor;
    return /^mesh/.test(key) ? "bp" : "ccm";
  }

  /** 프리셋 (μm) */
  const GASKET_PRESETS = [1000, 1500, 1700, 2000, 2400];
  const GROOVE_PRESETS = [200, 400, 600];
  const PTL_PRESETS = [250, 350];
  const GDL_PRESETS = [130, 180, 190, 290];

  /* ---------------- 단위 유틸 (내부는 항상 μm) ---------------- */

  function parseUm(raw) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return 0;
    return v < 10 ? Math.round(v * 1000) : Math.round(v);
  }
  /**
   * 화면에 표시된 단위(μm/mm)를 그대로 사용해 입력값을 μm 로 변환.
   * (자동 판별로 인한 오류 방지 - 예: 촉매 5μm 가 5mm 로 바뀌던 문제)
   * μm 는 소수점 유지(촉매 2.5μm 등), mm 는 ×1000.
   * @param {string|number} raw 입력값
   * @param {number} curUm 현재 저장값(μm) - 표시 단위 판단용
   */
  function parseUmWithUnit(raw, curUm) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return 0;
    const isMm = Number(curUm) >= 1000;   // 현재 mm 로 표시 중이면 mm 로 해석
    return isMm ? Math.round(v * 1000) : Math.round(v * 100) / 100;
  }
  function fmtUm(um) {
    if (um >= 1000) return `${Number((um / 1000).toFixed(3))} mm`;
    return `${Number(um.toFixed(1))} μm`;
  }
  function inputVal(um) {
    return um >= 1000 ? Number((um / 1000).toFixed(3)) : Number(um.toFixed(1));
  }
  function inputUnit(um) { return um >= 1000 ? "mm" : "μm"; }

  /* ============================================================ */

  const LayerDesign = {

    meaId: null,
    design: null,
    _initialized: false,

    /** 슬롯 메타 조회 (커스텀 층은 슬롯 데이터에서 라벨 사용) */
    meta(key) {
      if (SLOT_META[key]) return SLOT_META[key];
      const s = this.design?.slots[key];
      return { label: s?.label || "Layer", color: CUSTOM_COLOR, pair: s?.pairKey || null };
    },

    /* ---------------- 초기화 ---------------- */

    init() {
      if (this._initialized) return;
      this._initialized = true;

      document.getElementById("layerMeaSelect").addEventListener("change", (e) => {
        this.meaId = e.target.value || null;
        this.loadDesign();
        this.renderAll();
      });

      document.getElementById("symLock").addEventListener("change", (e) => {
        if (!this.design) return;
        this.design.symmetry = e.target.checked;
        this.persist();
      });

      // 압축률 슬라이더 - 끄는 동안 실시간 반영, 놓을 때 저장
      const slider = document.getElementById("compSlider");
      // max 는 _syncCompressionUI 에서 설계에 맞는 상한으로 갱신된다
      slider.addEventListener("input", (e) => {
        this.stopCompression();
        this.setCompression(e.target.value, false);
      });
      slider.addEventListener("change", () => { this.persist(); this.renderAll(); });

      document.getElementById("btnCompPlay").addEventListener("click", () => {
        if (this._anim) this.stopCompression(); else this.playCompression();
      });
      document.getElementById("btnCompFit").addEventListener("click", () => {
        const c = this.findContactCompression();
        this.setCompression(c);
        this.renderAll();
        Utils.toast(`전극이 CCM 에 닿는 압축률 ${c.toFixed(1)}% 를 적용했습니다.`);
      });
      document.getElementById("btnCompReset").addEventListener("click", () => {
        this.stopCompression();
        this.setCompression(0);
        this.renderAll();
      });

      // BP 표시 높이 (표시 전용 - 계산에는 영향 없음)
      document.getElementById("bpView").addEventListener("change", (e) => {
        if (!this.design) return;
        this.design.bpView = e.target.value;
        this.persist();
        this.renderSVG();
      });

      this._bindLibrary();

      document.getElementById("btnLayerReset").addEventListener("click", () => {
        if (!this.design) return;
        if (!confirm("설계를 기본값으로 초기화할까요? (추가한 층도 제거됩니다)")) return;
        this.design = defaultDesign();
        this.persist();
        this.renderAll();
      });

      // 층 추가 (PTL 2장 등) - 대칭 잠금 시 양쪽에 추가
      document.getElementById("btnAddInner").addEventListener("click", () => this.addInnerLayer());

      document.getElementById("btnLayerSaveJson").addEventListener("click", () => this.saveJSON());
      document.getElementById("btnLayerLoadJson").addEventListener("click", () =>
        document.getElementById("fileLayerJson").click());
      document.getElementById("fileLayerJson").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) this.loadJSON(file);
        e.target.value = "";
      });

      document.getElementById("btnLayerPng").addEventListener("click", () => this.exportPNG());
      document.getElementById("btnLayerSvg").addEventListener("click", () => this.exportSVG());

      this._bindEditorEvents();
      this._bindLayerModal();
      this._buildPitchCard();
    },

    refresh() {
      this.init();
      const select = document.getElementById("layerMeaSelect");
      const meas = Storage.state.meaList;
      if (!this.meaId || !Storage.getMea(this.meaId)) {
        this.meaId = Storage.state.selectedMeaId || meas[0]?.id || null;
      }
      select.innerHTML =
        `<option value="">MEA 를 선택하세요</option>` +
        meas.map((m) => `<option value="${m.id}" ${m.id === this.meaId ? "selected" : ""}>${m.name}</option>`).join("");
      this.loadDesign();
      this.renderAll();
    },

    loadDesign() {
      const saved = Storage.getMea(this.meaId)?.cellDesign;
      this.design = saved ? Object.assign(defaultDesign(), Utils.deepClone(saved)) : defaultDesign();
      const def = defaultDesign();
      // 기본 슬롯 누락 보강 (커스텀 슬롯은 유지)
      this.design.slots = Object.assign(def.slots, this.design.slots);
      this.design.targets = Object.assign(def.targets, this.design.targets);

      // 스키마 마이그레이션 (한 번 수행 후 저장해 재실행되지 않게 한다)
      const migrated = !saved?.v || saved.v < 6;
      if (!saved?.v || saved.v < 3) {
        // 가스켓 개구부 66mm, 매쉬 폭 61mm (기존 기본값이었던 경우만 갱신)
        ["gasketA", "gasketC"].forEach((k) => {
          const s = this.design.slots[k];
          if (s && s.opening <= 62) s.opening = 66;
        });
        ["meshA", "meshC"].forEach((k) => {
          const s = this.design.slots[k];
          if (s && s.w === 57) s.w = 61;
        });
        [["subA", "gasketA"], ["subC", "gasketC"]].forEach(([sk, gk]) => {
          const s = this.design.slots[sk], g = this.design.slots[gk];
          if (s && g) s.outer = g.outer;
        });
        this.design.v = 3;
      }
      if (!saved?.v || saved.v < 5) {
        // v5: 앵커/강체 속성 도입. 기존 설계에 기본값을 채운다.
        delete this.design.view;
        this.design.compression = 0;
        if (this.design.targets) delete this.design.targets.compression;
        Object.keys(this.design.slots).forEach((k) => {
          const s = this.design.slots[k];
          if (!s) return;
          const p = pathOf(k, s);
          if (p === "elec" && s.anchor === undefined) s.anchor = /^mesh/.test(k) ? "bp" : "ccm";
          if ((p === "elec" || p === "frame") && s.rigid === undefined) {
            s.rigid = p === "frame" ? /^sub/.test(k) : /^mesh/.test(k);
          }
        });
      }
      // v6: bpHalf(boolean) → bpView(3단계). 기본은 판재를 확 줄인 "min".
      if (!["min", "half", "full"].includes(this.design.bpView)) {
        this.design.bpView = this.design.bpHalf ? "half" : "min";
      }
      delete this.design.bpHalf;

      // v6: 눌리는 것은 가스켓뿐 - 전극/서브가스켓 강체 플래그를 바로잡는다
      if (!saved?.v || saved.v < 6) {
        Object.keys(this.design.slots).forEach((k) => {
          const s = this.design.slots[k];
          if (!s) return;
          const p = pathOf(k, s);
          if (p === "elec") s.rigid = true;                 // PTL 은 휘기만 한다
          if (p === "frame") s.rigid = /^sub/.test(k);      // 가스켓만 눌린다
        });
        if (this.design.compression > MAX_GASKET_COMPRESSION) this.design.compression = 0;
      }
      if (migrated) {
        this.design.v = 6;
        if (this.meaId) this.persist();
      }
      document.getElementById("symLock").checked = !!this.design.symmetry;
      this._syncCompressionUI();
    },

    persist() {
      if (this.meaId) Storage.updateMeaCellDesign(this.meaId, this.design);
    },

    renderAll() {
      this.renderEditor();
      this.renderPitch();
      this.renderSVG();
      this.renderLibrary();
    },

    /* ============================================================
     * 층 추가 (커스텀 내부 층: PTL 2장 등)
     * ============================================================ */

    /**
     * 층 추가 - 한 번에 하나씩 추가하고 드래그로 원하는 위치로 이동.
     * 기본 삽입 위치: Anode 내부 층의 끝 (CCM 쪽)
     */
    addInnerLayer() {
      if (!this.design) return;
      const raw = prompt("추가할 층 이름:", "PTL 2");
      if (!raw || !raw.trim()) return;
      const name = raw.trim();

      const d = this.design;
      const memIdx = d.order.indexOf("mem");

      /** 한쪽 면에 층을 삽입하고 새 키를 돌려준다 */
      const addTo = (side) => {
        const id = "x" + Utils.uid("L").slice(2);
        d.slots[id] = { label: name, th: 350, w: 57, custom: true };
        const mi = d.order.indexOf("mem");
        if (side === "A") {
          // Anode: 전극 경로의 가장 CCM 쪽에 삽입
          let insert = 0;
          d.order.forEach((k, i) => {
            if (i < mi && pathOf(k, d.slots[k]) === "elec") insert = i + 1;
          });
          d.order.splice(insert, 0, id);
        } else {
          // Cathode: order 가 CCM→BP 방향이므로 첫 전극 층 앞에 삽입
          let insert = d.order.length;
          for (let i = mi + 1; i < d.order.length; i++) {
            if (pathOf(d.order[i], d.slots[d.order[i]]) === "elec") { insert = i; break; }
          }
          d.order.splice(insert, 0, id);
        }
        return id;
      };

      const idA = addTo("A");
      // 좌우 대칭 잠금 시 Cathode 에도 같은 층을 추가한다
      if (d.symmetry && memIdx >= 0) {
        const idC = addTo("C");
        d.slots[idA].pairKey = idC;
        d.slots[idC].pairKey = idA;
      }

      this.persist();
      this.renderAll();
      Utils.toast(`'${name}' 층을 추가했습니다${d.symmetry ? " (양쪽 대칭)" : ""}. 드래그로 위치를 옮길 수 있습니다.`);
    },

    removeCustomLayer(key) {
      const d = this.design;
      const pairKey = d.slots[key]?.pairKey;
      d.order = d.order.filter((k) => k !== key);
      delete d.slots[key];
      delete d.hidden[key];          // 숨김 플래그 잔재 정리
      // 짝 참조 정리 (짝 층 자체는 남겨둠 - 비대칭 삭제 허용)
      if (pairKey && d.slots[pairKey]) delete d.slots[pairKey].pairKey;
      this.persist();
      this.renderAll();
    },

    /* ============================================================
     * Layer Editor (좌측)
     * ============================================================ */

    renderEditor() {
      const ul = document.getElementById("layerList");
      if (!this.meaId) {
        ul.innerHTML = `<li class="empty-msg">MEA 를 선택하면 설계를 시작할 수 있습니다.</li>`;
        return;
      }
      const d = this.design;

      // 행에는 이름 + (대표 셀렉트 1개) + 두께 입력만 표시.
      // 나머지 속성(폭/개구부/종류 등)은 행 클릭 → 상세 모달에서 편집.
      // 목록도 단면도와 같은 순서로 보여준다 (위 = Cathode, 아래 = Anode).
      // 내부 order 는 Anode→Cathode 순 그대로 두고 표시만 뒤집는다.
      ul.innerHTML = d.order.slice().reverse().map((key) => {
        const meta = this.meta(key);
        const s = d.slots[key];
        if (!s) return "";
        const hidden = !!d.hidden[key];

        let extra = "";
        if (key === "bpA" || key === "bpC") {
          extra = `<select data-sel="groove" title="Groove">
              ${GROOVE_PRESETS.map((g) => `<option value="${g}" ${s.groove === g ? "selected" : ""}>G ${g / 1000}T</option>`).join("")}
              <option value="__c__" ${!GROOVE_PRESETS.includes(s.groove) ? "selected" : ""}>G 직접</option>
            </select>`;
        } else if (key === "gasketA" || key === "gasketC") {
          extra = `<select data-sel="gasketTh" title="가스켓 규격">
              ${GASKET_PRESETS.map((g) => `<option value="${g}" ${s.th === g ? "selected" : ""}>${g / 1000}T</option>`).join("")}
              <option value="__c__" ${!GASKET_PRESETS.includes(s.th) ? "selected" : ""}>직접</option>
            </select>`;
        } else if (key === "ptlA" || key === "ptlC") {
          const presets = s.kind === "PTL" ? PTL_PRESETS : GDL_PRESETS;
          extra = `<select data-sel="thPreset" title="${s.kind} 두께 프리셋">
              ${presets.map((p) => `<option value="${p}" ${s.th === p ? "selected" : ""}>${p}μm</option>`).join("")}
              <option value="__c__" ${!presets.includes(s.th) ? "selected" : ""}>직접</option>
            </select>`;
        }

        const name = Utils.escapeHtml(s.custom ? s.label : meta.label);
        const sub = "";   // 종류·재질은 상세 모달에서 확인 (행 폭 확보)
        // 경로 배지: 프레임(실링)과 전극은 나란히 놓인 별개 경로라서
        // 서로의 순서를 바꿔도 기하가 달라지지 않는다는 점을 드러낸다.
        const p = pathOf(key, s);
        const chip = (p === "frame" || p === "elec")
          ? `<i class="ld-path ld-path-${p}" title="${PATH_LABEL[p]} 경로 · 같은 경로 안에서만 순서가 단면도에 반영됩니다"></i>`
          : "";

        return `
        <li class="ld-row ${hidden ? "ld-hidden" : ""}" draggable="true" data-key="${Utils.escapeHtml(key)}"
            style="border-left:5px solid ${meta.color}" title="클릭하면 상세 정보를 수정할 수 있습니다">
          <i class="bi bi-grip-vertical grip"></i>
          <span class="ld-nm">${name}<small>${sub}</small></span>${chip}
          <span class="ld-ctl">${extra}</span>
          <span class="ld-f" title="두께 (10 미만 = mm, 10 이상 = μm)">
            <input data-f="th" type="number" step="any" min="0" value="${inputVal(s.th)}" /><em>${inputUnit(s.th)}</em></span>
          <button class="ld-eye" title="${hidden ? "보이기" : "숨기기"}">
            <i class="bi ${hidden ? "bi-eye-slash" : "bi-eye"}"></i></button>
          ${s.custom ? `<button class="ld-remove" title="층 삭제"><i class="bi bi-x-lg"></i></button>` : ""}
        </li>`;
      }).join("");
    },

    /* ============================================================
     * Layer 상세 모달 (행 클릭 → 모든 속성 편집)
     * ============================================================ */

    _modalKey: null,

    openLayerModal(key) {
      const s = this.design.slots[key];
      if (!s) return;
      this._modalKey = key;
      const meta = this.meta(key);
      document.getElementById("layerModalTitle").innerHTML =
        `<i class="bi bi-layers-half"></i> ${Utils.escapeHtml(s.custom ? s.label : meta.label)}`;

      const F = [];
      if (s.custom) F.push(`<div class="meta-field"><label>층 이름</label><input data-lm="label" type="text" value="${Utils.escapeHtml(s.label)}" /></div>`);
      if (key === "ptlA" || key === "ptlC") {
        F.push(`<div class="meta-field"><label>종류</label>
          <select data-lm="kind">
            <option value="PTL" ${s.kind === "PTL" ? "selected" : ""}>PTL</option>
            <option value="GDL" ${s.kind === "GDL" ? "selected" : ""}>GDL</option>
          </select></div>`);
        F.push(`<div class="meta-field"><label>PTL Type</label>
          <select data-lm="ptlType">
            <option value="Felt" ${s.ptlType === "Felt" ? "selected" : ""}>Felt</option>
            <option value="Sintered" ${s.ptlType === "Sintered" ? "selected" : ""}>Sintered</option>
          </select></div>`);
      }
      // 전극 층: 어느 면에 붙는지 + 눌리는지
      if (pathOf(key, s) === "elec") {
        F.push(`<div class="meta-field"><label>붙는 면 (앵커)</label>
          <select data-lm="anchor">
            <option value="bp" ${anchorOf(key, s) === "bp" ? "selected" : ""}>BP측 - Bipolar Plate 면에 밀착</option>
            <option value="ccm" ${anchorOf(key, s) === "ccm" ? "selected" : ""}>CCM측 - 촉매면에 밀착</option>
          </select></div>`);
      }
      if (pathOf(key, s) === "elec" || pathOf(key, s) === "frame") {
        F.push(`<div class="meta-field"><label>압축 특성</label>
          <select data-lm="rigid">
            <option value="0" ${!isRigid(key, s) ? "selected" : ""}>압축 가능 (눌리면 두께가 줄어듦)</option>
            <option value="1" ${isRigid(key, s) ? "selected" : ""}>강체 (눌려도 두께가 그대로)</option>
          </select></div>`);
      }
      F.push(`<div class="meta-field"><label>두께 (현재 ${fmtUm(s.th)})</label>
        <input data-lm="th" type="number" step="any" min="0" value="${inputVal(s.th)}" /></div>`);
      if (s.w !== undefined)
        F.push(`<div class="meta-field"><label>폭 (mm)</label><input data-lm="w" type="number" step="any" min="0" value="${s.w}" /></div>`);
      if (s.opening !== undefined)
        F.push(`<div class="meta-field"><label>개구부 폭 (mm)</label><input data-lm="opening" type="number" step="any" min="0" value="${s.opening}" /></div>`);
      if (s.outer !== undefined)
        F.push(`<div class="meta-field"><label>외곽 폭 (mm)</label><input data-lm="outer" type="number" step="any" min="0" value="${s.outer}" /></div>`);
      if (s.groove !== undefined)
        F.push(`<div class="meta-field"><label>Groove 깊이 (현재 ${fmtUm(s.groove)})</label>
          <input data-lm="groove" type="number" step="any" min="0" value="${inputVal(s.groove)}" /></div>`);

      document.getElementById("layerModalBody").innerHTML = F.join("");
      document.getElementById("layerModal").hidden = false;
    },

    closeLayerModal() {
      document.getElementById("layerModal").hidden = true;
      this._modalKey = null;
    },

    saveLayerModal() {
      const key = this._modalKey;
      const s = this.design?.slots[key];
      if (!s) { this.closeLayerModal(); return; }

      document.querySelectorAll("#layerModalBody [data-lm]").forEach((el) => {
        const f = el.dataset.lm;
        if (f === "label") s.label = el.value.trim() || s.label;
        else if (f === "kind" || f === "ptlType" || f === "anchor") s[f] = el.value;
        else if (f === "rigid") s.rigid = el.value === "1";
        // 두께/그루브: 표시 단위 그대로 해석 (촉매 <10μm 오인식 방지)
        else if (f === "th") s.th = parseUmWithUnit(el.value, s.th);
        else if (f === "groove") s.groove = parseUmWithUnit(el.value, s.groove);
        else s[f] = Number(el.value) || 0;                                  // mm 값
      });

      this._syncPair(key);
      this.persist();
      this.closeLayerModal();
      this.renderAll();
      Utils.toast("층 정보를 수정했습니다.");
    },

    _bindLayerModal() {
      document.getElementById("layerModalClose").addEventListener("click", () => this.closeLayerModal());
      document.getElementById("layerModalCancel").addEventListener("click", () => this.closeLayerModal());
      document.getElementById("layerModalSave").addEventListener("click", () => this.saveLayerModal());
      document.getElementById("layerModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("layerModal")) this.closeLayerModal();
      });
      document.addEventListener("keydown", (e) => {
        if (document.getElementById("layerModal").hidden) return;
        if (e.key === "Escape") this.closeLayerModal();
        if (e.key === "Enter" && e.target.matches("#layerModalBody input")) this.saveLayerModal();
      });
    },

    _bindEditorEvents() {
      const ul = document.getElementById("layerList");

      const commit = Utils.debounce((key, field, raw) => {
        const s = this.design.slots[key];
        if (!s) return;
        // 두께: 현재 표시 단위 그대로 해석 (촉매 <10μm 오인식 방지)
        if (field === "th") s.th = parseUmWithUnit(raw, s.th);
        else if (field === "label") s.label = raw;
        else s[field] = Number(raw) || 0;
        this._syncPair(key);
        this.persist();
        this.renderPitch();  // 계산 실시간 반영
        this.renderSVG();    // 단면도 실시간 반영
        this._updateUnitHints(key);
      }, 150);

      ul.addEventListener("input", (e) => {
        const li = e.target.closest(".ld-row");
        if (!li) return;
        const input = e.target.closest("input[data-f]");
        if (input) { commit(li.dataset.key, input.dataset.f, input.value); return; }
        const rename = e.target.closest("input[data-f2]");
        if (rename) commit(li.dataset.key, "label", rename.value);
      });

      ul.addEventListener("change", (e) => {
        const sel = e.target.closest("select[data-sel]");
        const li = e.target.closest(".ld-row");
        if (!sel || !li) return;
        const key = li.dataset.key;
        const s = this.design.slots[key];
        const type = sel.dataset.sel;

        if (sel.value === "__c__") {
          const v = prompt("값 입력 (10 미만 = mm, 10 이상 = μm):");
          if (v !== null && v !== "") {
            if (type === "groove") s.groove = parseUm(v);
            else s.th = parseUm(v);
          }
        } else if (type === "groove") s.groove = Number(sel.value);
        else if (type === "gasketTh" || type === "thPreset") s.th = Number(sel.value);
        else if (type === "kind") {
          s.kind = sel.value;
          s.th = sel.value === "PTL" ? 350 : 190;
          s.ptlType = s.ptlType || "Felt";
        } else if (type === "ptlType") s.ptlType = sel.value;

        this._syncPair(key);
        this.persist();
        this.renderAll();
      });

      ul.addEventListener("click", (e) => {
        const li = e.target.closest(".ld-row");
        if (!li) return;
        if (e.target.closest(".ld-eye")) {
          const key = li.dataset.key;
          this.design.hidden[key] = !this.design.hidden[key];
          this.persist();
          this.renderAll();
        } else if (e.target.closest(".ld-remove")) {
          this.removeCustomLayer(li.dataset.key);
        } else if (!e.target.closest("input, select, button")) {
          // 행 빈 곳 클릭 → 상세 모달 열기
          this.openLayerModal(li.dataset.key);
        }
      });

      // Drag & Drop 순서 변경
      let dragging = null;
      ul.addEventListener("dragstart", (e) => {
        dragging = e.target.closest(".ld-row");
        if (dragging) dragging.classList.add("dragging");
      });
      ul.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragging) return;
        const items = [...ul.querySelectorAll(".ld-row:not(.dragging)")];
        let after = null, best = Number.NEGATIVE_INFINITY;
        for (const item of items) {
          const box = item.getBoundingClientRect();
          const offset = e.clientY - box.top - box.height / 2;
          if (offset < 0 && offset > best) { best = offset; after = item; }
        }
        if (after === dragging.nextSibling) return;
        if (after === null) { if (dragging.nextSibling !== null) ul.appendChild(dragging); }
        else ul.insertBefore(dragging, after);
      });
      ul.addEventListener("dragend", () => {
        if (!dragging) return;
        dragging.classList.remove("dragging");
        dragging = null;
        // 목록은 뒤집어 표시하므로 저장할 때 다시 뒤집는다
        this.design.order = [...ul.querySelectorAll(".ld-row")].map((el) => el.dataset.key).reverse();
        this.persist();
        this.renderPitch();
        this.renderSVG();
      });
    },

    _syncPair(key) {
      if (!this.design.symmetry) return;
      const pairKey = this.meta(key).pair;
      if (!pairKey || !this.design.slots[pairKey]) return;
      const keep = this.design.slots[pairKey].pairKey; // 짝 참조 보존
      this.design.slots[pairKey] = Utils.deepClone(this.design.slots[key]);
      if (keep !== undefined) this.design.slots[pairKey].pairKey = keep;
      else delete this.design.slots[pairKey].pairKey;

      const row = document.querySelector(`.ld-row[data-key="${pairKey}"]`);
      if (!row) return;
      const s = this.design.slots[pairKey];
      row.querySelectorAll("input[data-f]").forEach((input) => {
        const f = input.dataset.f;
        input.value = f === "th" ? inputVal(s.th) : (s[f] ?? "");
      });
      const rename = row.querySelector("input[data-f2]");
      if (rename && s.label) rename.value = s.label;
      this._updateUnitHints(pairKey);
    },

    _updateUnitHints(key) {
      const row = document.querySelector(`.ld-row[data-key="${key}"]`);
      if (!row) return;
      const em = row.querySelector('input[data-f="th"]')?.nextElementSibling;
      if (em) em.textContent = inputUnit(this.design.slots[key].th);
    },

    /* ============================================================
     * 계산
     * ============================================================ */

    /**
     * Cell Pitch - 조립 기하 기준.
     * 층 두께 단순 합(total)은 가스켓과 전극을 직렬로 더해버리므로
     * 실제보다 두껍다. 참고값으로만 함께 돌려준다.
     */
    computePitch() {
      const d = this.design;
      const vis = (k) => !d.hidden[k] && d.slots[k];
      const th = (k) => (vis(k) ? d.slots[k].th : 0);
      const total = d.order.reduce((a, k) => a + th(k), 0);
      const asm = this.computeAssembly();
      return {
        total,                       // 단순 합 (참고)
        grvA: asm.grvA, grvC: asm.grvC,
        pitch: asm.totalAsm,         // 실제 조립 높이 = Cell Pitch
        legacy: total - asm.grvA - asm.grvC, // 구 공식 (비교 표시용)
        ccm: th("catA") + th("mem") + th("catC"),
        asm,
      };
    },

    /**
     * 한쪽 면(BP 안쪽 면 → CCM)의 기하를 푼다.
     *
     * 좌표계: BP 안쪽 면 = 0, CCM 방향이 + (단위 μm).
     * 각 층의 값은 "시작점"이며 [pos, pos+th] 구간을 차지한다.
     * 프레임 경로의 첫 층은 홈에 잠기므로 시작점이 음수가 된다.
     *
     * 두 경로 각각은 층을 빈틈없이 이어 붙이므로 경로 내부에서는
     * 겹침도 공백도 원천적으로 생기지 않는다. 경로 간 높이 차이만
     * 밴드(공극/간섭)로 보고한다.
     *
     * @param {"A"|"C"} side
     */
    solveSide(side, squeezeUm) {
      const d = this.design;
      const S = (k) => d.slots[k];
      const vis = (k) => !d.hidden[k] && S(k);
      const memIdx = d.order.indexOf("mem");
      // 이 면의 가스켓이 눌린 양(μm). 양쪽 배분은 computeAssembly 가 정한다.
      const want = Math.max(0, squeezeUm || 0);

      // BP → CCM 방향 순서로 정규화 (Cathode 는 order 가 CCM→BP 이므로 뒤집는다)
      const raw = side === "A"
        ? d.order.slice(0, memIdx < 0 ? d.order.length : memIdx)
        : d.order.slice(memIdx < 0 ? d.order.length : memIdx + 1).slice().reverse();
      const keys = raw.filter((k) => vis(k) && !BP_KEYS.includes(k) && !CCM_KEYS.includes(k));

      const frameKeys = keys.filter((k) => pathOf(k, S(k)) === "frame");
      const elecKeys = keys.filter((k) => pathOf(k, S(k)) === "elec");

      // 전극은 붙는 면에 따라 두 그룹으로 나뉜다 (BP 면 / 촉매면)
      const elecBP = elecKeys.filter((k) => anchorOf(k, S(k)) === "bp");
      const elecCCM = elecKeys.filter((k) => anchorOf(k, S(k)) === "ccm");

      const bpKey = side === "A" ? "bpA" : "bpC";
      const catKey = side === "A" ? "catA" : "catC";
      const groove = vis(bpKey) ? Math.max(S(bpKey).groove || 0, 0) : 0;
      const catTh = vis(catKey) ? S(catKey).th : 0;
      const grooveUsed = frameKeys.length ? Math.min(groove, S(frameKeys[0]).th) : 0;

      const bands = [];
      const effTh = {};
      const sum = (keys, f) => keys.reduce((a, k) => a + f(k), 0);

      /* ── 1. 프레임 경로: 눌리는 것은 가스켓뿐이다.
       * 전극(Mesh·PTL·GDL)과 서브가스켓은 두께가 변하지 않는다. */
      const squeezable = sum(frameKeys, (k) => (isRigid(k, S(k)) ? 0 : S(k).th));
      const gasketSqueeze = Math.min(want, squeezable);
      const cEff = squeezable > 0 ? (gasketSqueeze / squeezable) * 100 : 0;

      const framePos = {};
      frameKeys.forEach((k) => {
        effTh[k] = isRigid(k, S(k)) ? S(k).th : S(k).th * (1 - cEff / 100);
      });
      let fo = -grooveUsed;
      frameKeys.forEach((k) => { framePos[k] = fo; fo += effTh[k]; });
      const frameH = fo;   // 프레임 바깥(막이 없는 구간)에서의 접촉면

      /* ── 2. CCM 조립체
       * 서브가스켓은 막과 hot pressing 되어 벌어질 수 없다. 막이 없는 바깥
       * 구간에서는 양쪽 서브가스켓이 맞닿아 가스켓 위에 그대로 얹히고,
       * 막이 잡힌 안쪽 구간은 막 두께의 절반만큼 BP 쪽으로 밀려난다.
       *   바깥 : 서브 200 + 서브 200        = 400μm  ← 가스켓이 만나는 면
       *   안쪽 : 서브 200 + 막 80 + 서브 200 = 480μm
       * 따라서 막(과 촉매)의 면은 프레임 상단보다 막 두께의 절반만큼 앞에 있다. */
      const innerRing = frameKeys.length ? frameKeys[frameKeys.length - 1] : null;
      const memTh = vis("mem") ? S("mem").th : 0;
      const memW = vis("mem") ? S("mem").w : 0;
      // 막이 서브가스켓 외곽을 다 덮으면 서로 맞닿는 구간이 없다 → 밀림 없음
      const memHalf = (innerRing && memTh > 0 && S(innerRing).outer > memW + 0.01)
        ? memTh / 2 : 0;

      let P = frameH - memHalf;           // BP 면 ~ 막의 이쪽 면
      let avail = P - catTh;              // BP 면 ~ 촉매 상단

      /* ── 3. 층별로 도달 가능한 면
       * 폭이 프레임 개구부보다 넓은 층은 그 링의 BP 쪽 면에 걸려 멈춘다.
       * 좁은 층은 개구부를 통과해 더 깊이(촉매까지) 들어간다.
       * 그룹 전체를 한 기준면에 붙이면 안 된다 - 얇은 GDL 위의 넓은 PTL 이
       * 링 높이로 밀려 들어가는 문제가 생긴다. */
      // 전극이 링에 걸리는 면. 서브가스켓의 안쪽(막을 잡은) 구간은 막 두께의
      // 절반만큼 BP 쪽으로 밀려 있으므로 그 면이 실제 걸림면이다.
      // frameShift: 전극이 프레임을 밀어낸 경우 링도 함께 밀려난다
      let frameShift = 0;
      const ringFaceFor = (k) => {
        let lim = Infinity, ring = null;
        frameKeys.forEach((fk) => {
          if (S(k).w <= S(fk).opening) return;
          const face = framePos[fk] - (fk === innerRing ? memHalf : 0) + frameShift;
          if (face < lim) { lim = face; ring = fk; }
        });
        return { lim, ring };
      };

      /* ── 4. 전극은 두께가 변하지 않는다 (PTL 은 휘기만 한다) */
      const elecSqueeze = 0, elecRatio = 0;
      elecKeys.forEach((k) => { effTh[k] = S(k).th; });

      /* ── 5. 배치
       * BP 그룹은 BP 면부터, CCM 그룹은 촉매면에서 거꾸로 쌓는다.
       * 아직 여유가 있으면 둘 사이에 공극이 남고 층은 평평하다. */
      const elecPos = {};
      let o = 0;
      elecBP.forEach((k) => { elecPos[k] = o; o += effTh[k]; });
      const bpTop = o;

      /* 촉매면에서부터 바깥으로, 각 층이 갈 수 있는 데까지 넣는다.
       * bendOf[k] = 그 층의 "테두리가 중앙보다 뒤처진 양".
       *   링에 걸린 층은 테두리가 링 면에 얹힌 채 중앙만 개구부 안으로
       *   밀려 들어간다. 두께는 변하지 않고 접시처럼 휜다.
       * roomBelow[k] = 그 층 중앙 아래(CCM 쪽)에 남은 빈 공간
       */
      const roomBelow = {}, blockedBy = {}, bendOf = {};
      const placeCCM = () => {
        let cur = avail;
        for (let i = elecCCM.length - 1; i >= 0; i--) {
          const k = elecCCM[i];
          const rf = ringFaceFor(k);
          const rimCeil = rf.ring ? rf.lim + (bendOf[k] || 0) : Infinity;
          const top = Math.min(cur, rimCeil);
          roomBelow[k] = cur - top;
          blockedBy[k] = rf.ring && rimCeil <= cur + 0.01 ? rf.ring : null;
          elecPos[k] = top - effTh[k];       // 중앙부 기준 위치
          cur = top - effTh[k];
        }
        return cur;
      };
      elecCCM.forEach((k) => { bendOf[k] = 0; });
      let ccmBottom = placeCCM();

      /* ── 6. 매쉬가 밀기 시작하면 그때부터 휜다
       * 공극이 사라진 뒤 계속 조이면, 뒤의 층이 앞의 층을 민다. 링에 걸린
       * 층은 두께를 유지한 채 중앙이 개구부 안으로 밀려 들어간다(휨).
       * 휨 여유가 다 소진된 뒤에야 비로소 층이 눌려 얇아진다.
       * 압축 전에는 bend = 0 (완전히 평평). */
      let bend = 0;
      const bendable = () => {
        for (let i = elecCCM.length - 1; i >= 0; i--) {
          const k = elecCCM[i];
          if (blockedBy[k] && roomBelow[k] > 0.001) return k;
        }
        return null;
      };
      let bendKey = bendable();
      const maxBend = bendKey ? roomBelow[bendKey] : 0;
      for (let guard = 0; guard < 8; guard++) {
        const ex = bpTop - ccmBottom;        // 매쉬가 밀어붙인 양
        const k = bendable();
        if (ex <= 0.001 || !k) break;
        const step = Math.min(ex, roomBelow[k]);
        bendOf[k] += step;
        if (k === bendKey) bend += step;
        ccmBottom = placeCCM();
      }

      // 휨 여유까지 다 쓰면 더는 닫히지 않는다. 그 이상 조이면 전극이 프레임을
      // 밀어내는 물리적 한계 상태 - 슬라이더 상한(maxCompression)이 이를 막는다.
      const push = bpTop - ccmBottom;
      if (push > 0.001) {
        P += push; avail += push; frameShift = push;
        ccmBottom = placeCCM();
      }

      // 개구부 안쪽에 남은 빈 공간 (층끼리 안 닿는 구간) 을 모두 보고한다
      elecCCM.forEach((k) => {
        const top = elecPos[k] + effTh[k];
        if (roomBelow[k] > 0.5) bands.push({
          path: "elec", kind: "gap", s: top, e: top + roomBelow[k], um: roomBelow[k],
          text: `공극 ${fmtUm(roomBelow[k])}`,
          detail: `${this.meta(k).label} 아래 공극 ${fmtUm(roomBelow[k])} - 개구부 안에서 층이 닿지 않음`,
        });
      });
      if (push > 0.5) bands.push({
        path: "frame", kind: "press", s: frameH, e: frameH + push, um: push,
        text: `밀림 ${fmtUm(push)}`,
        detail: `전극이 더 두꺼워 프레임을 ${fmtUm(push)} 밀어냄 - 실링 불량`,
      });

      const slack = ccmBottom - bpTop;
      if (slack > 0.5) bands.push({
        path: "elec", kind: "gap", s: bpTop, e: ccmBottom, um: slack,
        text: `공극 ${fmtUm(slack)}`,
        detail: `공극 ${fmtUm(slack)} · 압축률을 올리면 매쉬가 닿습니다`,
      });

      return {
        side, frameKeys, elecKeys, elecBP, elecCCM, framePos, elecPos, effTh,
        grooveUsed, frameH, elecH: sum(elecKeys, (k) => effTh[k]), catTh,
        bands, P, avail, maxBend, bpTop, slack, roomBelow, blockedBy,
        // 휨: 두께는 그대로 두고 중앙이 개구부 안으로 밀려 들어간 깊이
        // bendOf[k] = 층별 휨량 (테두리가 중앙보다 뒤처진 양)
        bend, bendOf, rimSqueeze: 0, bendKey: bend > 0.5 ? bendKey : null,
        bendOpening: bendKey && blockedBy[bendKey] ? S(blockedBy[bendKey]).opening : null,
        contact: slack <= 0.5,
        cEff, rigidLimited: push > 0.5, pushUm: Math.max(push, 0), gasketSqueeze,
        frameSqueezable: squeezable,
        elecSqueeze, elecRatio,
        minOpening: frameKeys.length ? Math.min(...frameKeys.map((k) => S(k).opening)) : null,
      };
    },

    /**
     * 조립 기하 계산 (단면도/피치 카드 공용)
     *
     * [압축 모델]
     * 눌리는 것은 가스켓뿐이다. 전극(Mesh·PTL·GDL)과 서브가스켓은 두께가
     * 변하지 않고, PTL 은 휘어서 공간을 메운다.
     *
     * 공극이 사라지는 순서 (셀 전체 기준):
     *   1) 매쉬 ↔ PTL 공극 - Anode·Cathode 양쪽 모두 사라질 때까지
     *   2) 그 다음에야 PTL 이 휘어 촉매 ↔ PTL 공극을 메운다
     *   3) 둘 다 끝나면 더 조일 수 없다 → maxCompression 이 슬라이더를 막는다
     *
     * [압축률이 양쪽 같은 구간과 다른 구간]
     * 양쪽 모두 공극이 남아 있는 동안에는 가스켓이 힘을 나눠 받으므로
     * 압축률이 같다. 한쪽 공극이 먼저 닫히면 그쪽은 전극 기둥이 하중을
     * 받아 가스켓 압축이 멈추고, 남은 공극 쪽 가스켓만 계속 눌린다.
     * 그 결과 CCM 조립체가 공극이 있는 쪽으로 이동한다.
     * (양쪽을 계속 같은 비율로 누르면 공극이 남은 채로 반대쪽 PTL 이 먼저
     *  휘어버리므로, 위 순서와 양립하지 않는다.)
     */
    computeAssembly(cOverride) {
      const d = this.design;
      const vis = (k) => !d.hidden[k] && d.slots[k];
      const th = (k) => (vis(k) ? d.slots[k].th : 0);
      const c = Math.max(0, Math.min(
        cOverride === undefined ? (d.compression || 0) : cOverride, MAX_GASKET_COMPRESSION));

      // 비압축 상태에서 각 면이 메워야 할 양
      const p0A = this.solveSide("A", 0), p0C = this.solveSide("C", 0);
      const gapA = Math.max(p0A.slack, 0), gapC = Math.max(p0C.slack, 0);
      const bendA = Math.max(p0A.maxBend, 0), bendC = Math.max(p0C.maxBend, 0);
      const sqA = p0A.frameSqueezable, sqC = p0C.frameSqueezable;

      // 슬라이더 % → 총 조임량 (양쪽 가스켓 두께 합 기준)
      let budget = (sqA + sqC) * (c / 100);
      let a = 0, cc = 0;
      const give = (toA, room) => {                    // 한쪽에만 배분
        const t = Math.min(room, budget);
        if (t > 0) { if (toA) a += t; else cc += t; budget -= t; }
      };
      // 1단계: 매쉬 ↔ PTL 공극 - 양쪽 동시에, 먼저 닫힌 쪽은 멈춘다
      const e1 = Math.max(Math.min(gapA, gapC, budget / 2), 0);
      a += e1; cc += e1; budget -= 2 * e1;
      give(true, gapA - a);
      give(false, gapC - cc);
      // 2단계: 모든 매쉬 ↔ PTL 공극이 닫힌 뒤에야 PTL 이 휜다
      const e2 = Math.max(Math.min(bendA, bendC, budget / 2), 0);
      a += e2; cc += e2; budget -= 2 * e2;
      give(true, gapA + bendA - a);
      give(false, gapC + bendC - cc);

      const LA = this.solveSide("A", a);
      const LC = this.solveSide("C", cc);
      const totalAsm = th("bpA") + LA.P + th("mem") + LC.P + th("bpC");

      return {
        LA, LC,
        grvA: LA.grooveUsed, grvC: LC.grooveUsed,
        innerA: LA.elecKeys, innerC: LC.elecKeys,
        totalAsm,
        // + 면 CCM 이 Cathode 쪽(아래)으로, − 면 Anode 쪽(위)으로 치우침
        ccmOffset: (LA.P - LC.P) / 2,
        unusedSqueeze: 0,
      };
    },

    /**
     * 더 조일 수 없는 압축률(%). 양쪽 모두 공극이 사라지고 휨 여유까지
     * 소진되면 그 이상은 물리적으로 닫히지 않으므로 슬라이더를 여기서 막는다.
     */
    maxCompression() {
      const p0A = this.solveSide("A", 0), p0C = this.solveSide("C", 0);
      const sq = p0A.frameSqueezable + p0C.frameSqueezable;
      // 비압축 상태에서 이미 전극이 프레임을 밀고 있으면(설계 자체가 성립 불가)
      // 조일 수 있는 여지가 없다
      if (sq <= 0 || p0A.pushUm > 0.5 || p0C.pushUm > 0.5) return 0;
      const need = Math.max(p0A.slack, 0) + Math.max(p0A.maxBend, 0)
        + Math.max(p0C.slack, 0) + Math.max(p0C.maxBend, 0);
      // 모든 공극과 휨 여유를 다 쓰는 지점 = 더 조일 수 없는 한계
      // (0.01% 단위로 내림해 한계를 넘지 않게 한다)
      return Math.max(0, Math.min(
        Math.floor((need / sq) * 10000) / 100, MAX_GASKET_COMPRESSION));
    },

    /**
     * 전극이 CCM 에 막 닿는 압축률(%)을 이분탐색으로 찾는다.
     * "접촉점 자동 맞춤" 버튼에서 사용.
     */
    findContactCompression() {
      // 완전 접촉 = 매쉬~PTL 공극이 사라지고(slack 0) PTL 이 촉매면까지 밀려 들어간 상태
      const remainAt = (c) => {
        const a = this.computeAssembly(c);
        const rem = (Lx) => Math.max(Lx.slack, 0) + Math.max(Lx.maxBend - Lx.bend, 0);
        return Math.max(rem(a.LA), rem(a.LC));
      };
      if (remainAt(0) <= 0.5) return 0;
      if (remainAt(MAX_GASKET_COMPRESSION) > 0.5) return MAX_GASKET_COMPRESSION;
      let lo = 0, hi = MAX_GASKET_COMPRESSION;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (remainAt(mid) > 0.5) lo = mid; else hi = mid;
      }
      return Math.round(hi * 10) / 10;
    },

    /**
     * 설계 진단 - 물리적으로 성립하지 않는 조합을 모아서 돌려준다.
     * @returns {{level:"warn"|"error", text:string}[]}
     */
    diagnose() {
      const d = this.design;
      const S = (k) => d.slots[k];
      const vis = (k) => !d.hidden[k] && S(k);
      const asm = this.computeAssembly();
      const out = [];

      ["A", "C"].forEach((side) => {
        const Lx = side === "A" ? asm.LA : asm.LC;
        const other = side === "A" ? asm.LC : asm.LA;
        const bpW = vis(side === "A" ? "bpA" : "bpC") ? S(side === "A" ? "bpA" : "bpC").w : Infinity;
        const nm = side === "A" ? "Anode" : "Cathode";

        Lx.bands.forEach((b) => out.push({
          level: b.kind === "gap" ? "warn" : "error",
          text: `${nm} · ${b.detail || b.text}`,
        }));
        if (Lx.cEff > 0.05) out.push({
          level: Lx.cEff > 30 ? "error" : "ok",
          text: `${nm} · 가스켓 ${fmtUm(Lx.gasketSqueeze)} 압축 (${Lx.cEff.toFixed(1)}%)` +
            (Lx.cEff > 30 ? " - 30% 초과, 과압축" : ""),
        });
        // 이 면은 이미 닫혀 반대편 공극이 닫히는 동안 가스켓이 멈춰 있다
        if (Lx.slack <= 0.5 && Lx.maxBend - Lx.bend > 0.5 && other && other.slack > 0.5) out.push({
          level: "ok",
          text: `${nm} · 매쉬–PTL 접촉 완료 - 반대편 공극이 닫힐 때까지 이 면의 가스켓은 정지 (CCM 이 반대편으로 이동)`,
        });
        if (Lx.rigidLimited) out.push({
          level: "error",
          text: `${nm} · 전극이 모두 강체라 더 닫히지 않는데 ${fmtUm(Lx.pushUm)} 더 조여짐 - 실링 분리`,
        });
        if (Lx.bend > 0.5) out.push({
          level: Lx.bend >= Lx.maxBend - 0.5 ? "ok" : "warn",
          text: `${nm} · ${this.meta(Lx.bendKey).label} 이 매쉬에 밀려 개구부 ${Lx.bendOpening}mm 안으로 ` +
            `${fmtUm(Lx.bend)} 들어감` +
            (Lx.bend >= Lx.maxBend - 0.5 ? " - 촉매에 접촉" : ` (촉매까지 ${fmtUm(Lx.maxBend - Lx.bend)} 남음)`) +
            " (두께 유지)",
        });
        // 매쉬는 닿았는데 아직 촉매에 못 닿은 상태
        if (Lx.contact && Lx.maxBend > 0.5 && Lx.bend < Lx.maxBend - 0.5) out.push({
          level: "warn",
          text: `${nm} · 전극이 촉매면까지 ${fmtUm(Lx.maxBend - Lx.bend)} 못 미침 - 압축률을 더 올려야 접촉`,
        });

        Lx.frameKeys.forEach((k) => {
          const s = S(k);
          if (s.opening >= s.outer) out.push({ level: "error", text: `${this.meta(k).label} · 개구부(${s.opening}mm) ≥ 외폭(${s.outer}mm) - 링 형상이 성립하지 않음` });
          if (s.outer > bpW) out.push({ level: "error", text: `${this.meta(k).label} · 외폭 ${s.outer}mm 가 BP 폭 ${bpW}mm 를 벗어남` });
        });
        // 전극 폭 판정
        // - 가장 바깥 프레임(가스켓) 개구부를 넘으면 애초에 들어가지 않는다 → 오류
        // - 그 안쪽(Sub Gasket) 개구부만 넘는 것은 링 위에 얹히는 정상 조건 → 경고
        const outerOpening = Lx.frameKeys.length ? S(Lx.frameKeys[0]).opening : null;
        Lx.elecKeys.forEach((k) => {
          const w = S(k).w, name = this.meta(k).label;
          if (outerOpening != null && w > outerOpening) {
            out.push({ level: "error", text: `${name} · 폭 ${w}mm 가 가스켓 개구부 ${outerOpening}mm 보다 커서 안으로 들어가지 않음` });
            return;
          }
          // 링 위에 얹히는 것은 정상. 휨으로 접촉하는 층은 위에서 따로 알린다.
          const lim = this._openingAt(Lx, k);
          if (lim != null && w > lim && k !== Lx.bendKey) out.push({
            level: "warn",
            text: `${name} · 폭 ${w}mm 가 개구부 ${lim}mm 보다 넓어 프레임 링 위에 얹힙니다`,
          });
        });
        const grooveNominal = vis(side === "A" ? "bpA" : "bpC") ? S(side === "A" ? "bpA" : "bpC").groove : 0;
        if (grooveNominal > Lx.grooveUsed) out.push({
          level: "warn",
          text: `${nm} · Groove ${fmtUm(grooveNominal)} 가 첫 프레임 층 두께보다 깊어 ${fmtUm(Lx.grooveUsed)} 만 사용됨`,
        });
      });

      // 강체 한계로 슬라이더 조임량이 다 들어가지 못한 경우
      if (asm.unusedSqueeze > 0.5) out.push({
        level: "warn",
        text: `압축 한계 - 조임량 중 ${fmtUm(asm.unusedSqueeze)} 는 강체(Mesh 등)에 막혀 적용되지 않음`,
      });

      // CCM 이동 (양쪽 접촉 시점이 다르면 공극이 있는 쪽으로 밀려간다 - 정상 거동)
      const off = asm.ccmOffset;
      if (Math.abs(off) > 0.5) out.push({
        level: "ok",
        text: `CCM 이 중앙에서 ${fmtUm(Math.abs(off))} ${off > 0 ? "Cathode" : "Anode"} 쪽으로 이동` +
          ` (Anode ${fmtUm(asm.LA.P)} / Cathode ${fmtUm(asm.LC.P)})`,
      });
      return out;
    },

    /**
     * 목표 Cell Pitch 에 도달하는 압축률(%). 강체 한계로 불가능하면 null.
     */
    _compressionForPitch(targetUm) {
      const at = (c) => this.computeAssembly(c).totalAsm;
      if (at(MAX_GASKET_COMPRESSION) > targetUm + 0.5) return null;
      let lo = 0, hi = MAX_GASKET_COMPRESSION;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid) > targetUm) lo = mid; else hi = mid;
      }
      return Math.round(hi * 10) / 10;
    },

    /* ============================================================
     * 압축 슬라이더 · 애니메이션
     * ============================================================ */

    /** 압축률 적용 (슬라이더/애니메이션 공용). 무거운 재렌더는 하지 않는다. */
    setCompression(c, persist = true) {
      if (!this.design) return;
      const lim = this._cMax || MAX_GASKET_COMPRESSION;
      this.design.compression = Math.max(0, Math.min(Number(c) || 0, lim));
      if (persist) this.persist();
      this.renderPitch(false);
      this.renderSVG();
    },

    /** 슬라이더 · 상태 뱃지 · Pitch · 접촉점 눈금을 현재 값에 맞춘다 */
    _syncCompressionUI() {
      const sl = document.getElementById("compSlider");
      if (!sl || !this.design) return;
      const c = this.design.compression || 0;
      if (document.activeElement !== sl) sl.value = c;
      document.getElementById("compValue").textContent = `${Number(c).toFixed(1)} %`;

      const bv = document.getElementById("bpView");
      if (bv) bv.value = this.design.bpView;

      const asm = this.computeAssembly();
      // 한쪽 공극이 먼저 닫히면 그쪽 가스켓은 멈추므로 압축률이 갈릴 수 있다
      const eq = Math.abs(asm.LA.cEff - asm.LC.cEff) < 0.05;
      document.getElementById("compPitch").innerHTML = eq
        ? `Pitch ${(asm.totalAsm / 1000).toFixed(3)} mm`
        : `A ${asm.LA.cEff.toFixed(1)}% / C ${asm.LC.cEff.toFixed(1)}%<br>Pitch ${(asm.totalAsm / 1000).toFixed(3)} mm`;

      // 상태: 공극 → 매쉬 접촉 → 완전 접촉 → 과압축
      const worst = (f) => Math.max(f(asm.LA), f(asm.LC));
      const gap = worst((L) => L.slack);
      const rem = worst((L) => L.maxBend - L.bend);
      const pushed = worst((L) => L.P - L.frameH);
      const st = document.getElementById("compState");
      let cls = "ok", txt = "완전 접촉";
      if (pushed > 50) { cls = "bad"; txt = `과압축 · 실링 ${fmtUm(pushed)} 뜸`; }
      else if (pushed > 0.5) { cls = "warn"; txt = `완전 접촉 · 실링 여유 없음`; }
      else if (gap > 0.5) { cls = "warn"; txt = `공극 ${fmtUm(gap)}`; }
      else if (rem > 0.5) { cls = "warn"; txt = `촉매까지 ${fmtUm(rem)}`; }
      else if (asm.LA.cEff > 30) { cls = "warn"; txt = "완전 접촉 (과압축 주의)"; }
      st.className = `comp-state ${cls}`;
      st.textContent = txt;

      // 접촉점 눈금 + 슬라이더 상한 (캐시 - 설계가 바뀔 때만 다시 계산)
      const sig = JSON.stringify([this.design.order, this.design.slots, this.design.hidden]);
      if (sig !== this._tickSig) {
        this._tickSig = sig;
        this._ticks = {
          mesh: this._findCompression((L) => L.slack),
          ccm: this._findCompression((L) => Math.max(L.slack, 0) + Math.max(L.maxBend - L.bend, 0)),
        };
        // 공극이 다 사라지면 더 조일 수 없다 → 슬라이더를 거기서 막는다
        this._cMax = Math.max(this.maxCompression(), 0.1);
      }
      sl.max = this._cMax;
      if (this.design.compression > this._cMax) {
        this.design.compression = this._cMax;
        sl.value = this._cMax;
        document.getElementById("compValue").textContent = `${this._cMax.toFixed(1)} %`;
      }
      // 세로 트랙: 위(0%) → 아래(최대) 로 조여진다
      const place = (id, val, label) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (val == null || val > this._cMax + 0.01) { el.hidden = true; return; }
        el.hidden = false;
        el.style.top = `${(val / this._cMax) * 100}%`;
        el.title = `${label} ${val.toFixed(1)}%`;
      };
      place("tickMesh", this._ticks.mesh, "매쉬 접촉");
      place("tickCcm", this._ticks.ccm, "촉매 접촉");
    },

    /** metric(Lx) 이 0 이 되는 최소 압축률. 끝까지 0 이 안 되면 null. */
    _findCompression(metric) {
      const at = (c) => {
        const a = this.computeAssembly(c);
        return Math.max(metric(a.LA), metric(a.LC));
      };
      if (at(0) <= 0.5) return 0;
      if (at(MAX_GASKET_COMPRESSION) > 0.5) return null;
      let lo = 0, hi = MAX_GASKET_COMPRESSION;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid) > 0.5) lo = mid; else hi = mid;
      }
      return Math.round(hi * 10) / 10;
    },

    /** 0% → 현재 압축률까지 자동 재생 */
    playCompression() {
      if (!this.design || this._anim) return;
      const target = this.design.compression || 0;
      if (target <= 0) { Utils.toast("압축률을 올린 뒤 재생해 주세요."); return; }
      const btn = document.getElementById("btnCompPlay");
      if (btn) btn.innerHTML = `<i class="bi bi-stop-fill"></i>`;
      const dur = 1600, t0 = performance.now();
      const step = (now) => {
        const p = Math.min((now - t0) / dur, 1);
        // ease-in-out - 체결이 서서히 붙었다가 멈추는 느낌
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        this.design.compression = target * e;
        this.renderPitch(false);
        this.renderSVG();
        if (p < 1) { this._anim = requestAnimationFrame(step); }
        else { this._anim = null; this.design.compression = target; this.persist(); this.renderAll();
               if (btn) btn.innerHTML = `<i class="bi bi-play-fill"></i>`; }
      };
      this._anim = requestAnimationFrame(step);
    },

    stopCompression() {
      if (!this._anim) return;
      cancelAnimationFrame(this._anim);
      this._anim = null;
      const btn = document.getElementById("btnCompPlay");
      if (btn) btn.innerHTML = `<i class="bi bi-play-fill"></i>`;
      this.persist();
      this.renderAll();
    },

    /* ============================================================
     * 설계 라이브러리 (이름 붙여 저장 → 현재 MEA 에 적용)
     * ============================================================ */

    renderLibrary() {
      const ul = document.getElementById("designLib");
      if (!ul) return;
      const list = Storage.state.cellDesigns || [];
      if (!list.length) {
        ul.innerHTML = `<li class="empty-msg">저장된 설계가 없습니다. "설계 저장" 으로 현재 구성을 보관하세요.</li>`;
        return;
      }
      ul.innerHTML = list.slice().reverse().map((it) => {
        const when = new Date(it.savedAt);
        const pitch = it.design?.slots
          ? "" : "";
        return `<li class="lib-row" data-id="${Utils.escapeHtml(it.id)}">
          <span class="lib-main">
            <b>${Utils.escapeHtml(it.name)}</b>
            <small>${when.toLocaleDateString()} ${when.toLocaleTimeString().slice(0, 5)}${
              it.meaName ? " · " + Utils.escapeHtml(it.meaName) : ""}${pitch}</small>
          </span>
          <button class="btn btn-sm btn-primary lib-apply" title="현재 선택된 MEA 에 적용">적용</button>
          <button class="lib-icon lib-update" title="현재 설계로 덮어쓰기"><i class="bi bi-arrow-repeat"></i></button>
          <button class="lib-icon lib-rename" title="이름 변경"><i class="bi bi-pencil"></i></button>
          <button class="lib-icon lib-del" title="삭제"><i class="bi bi-x-lg"></i></button>
        </li>`;
      }).join("");
    },

    saveToLibrary() {
      if (!this.design || !this.meaId) { Utils.toast("MEA 를 먼저 선택해 주세요."); return; }
      const meaName = Storage.getMea(this.meaId)?.name || "";
      const name = prompt("설계 이름:", `${meaName} 설계`);
      if (name === null) return;
      Storage.saveCellDesign(name, this.design, meaName);
      this.renderLibrary();
      Utils.toast("설계를 라이브러리에 저장했습니다.");
    },

    applyFromLibrary(id) {
      const item = Storage.getCellDesign(id);
      if (!item || !this.meaId) return;
      const meaName = Storage.getMea(this.meaId)?.name || "현재 MEA";
      if (!confirm(`'${item.name}' 설계를 ${meaName} 에 적용할까요?\n현재 설계는 덮어씁니다.`)) return;
      this.design = Object.assign(defaultDesign(), Utils.deepClone(item.design));
      this.design.slots = Object.assign(defaultDesign().slots, this.design.slots);
      this.persist();
      this.renderAll();
      Utils.toast(`'${item.name}' 설계를 적용했습니다.`);
    },

    _bindLibrary() {
      const ul = document.getElementById("designLib");
      if (!ul) return;
      document.getElementById("btnDesignSave").addEventListener("click", () => this.saveToLibrary());
      ul.addEventListener("click", (e) => {
        const row = e.target.closest(".lib-row");
        if (!row) return;
        const id = row.dataset.id;
        if (e.target.closest(".lib-apply")) this.applyFromLibrary(id);
        else if (e.target.closest(".lib-update")) {
          if (!this.design) return;
          Storage.updateCellDesign(id, this.design);
          this.renderLibrary();
          Utils.toast("저장된 설계를 현재 구성으로 갱신했습니다.");
        } else if (e.target.closest(".lib-rename")) {
          const cur = Storage.getCellDesign(id);
          const name = prompt("새 이름:", cur?.name || "");
          if (name !== null) { Storage.renameCellDesign(id, name); this.renderLibrary(); }
        } else if (e.target.closest(".lib-del")) {
          const cur = Storage.getCellDesign(id);
          if (confirm(`'${cur?.name}' 설계를 삭제할까요?`)) {
            Storage.removeCellDesign(id);
            this.renderLibrary();
          }
        }
      });
    },

    /**
     * 전극 층 key 가 놓인 높이에서의 프레임 개구부 폭(mm).
     * 같은 높이를 공유하는 프레임 층이 없으면 null.
     */
    _openingAt(Lx, key) {
      const d = this.design;
      const s = d.slots[key];
      if (!s) return null;
      const a0 = Lx.elecPos[key], a1 = a0 + Lx.effTh[key];
      let lim = null;
      Lx.frameKeys.forEach((fk) => {
        const f = d.slots[fk];
        const b0 = Lx.framePos[fk], b1 = b0 + Lx.effTh[fk];
        if (Math.min(a1, b1) - Math.max(a0, b0) > 0.01) {
          lim = lim == null ? f.opening : Math.min(lim, f.opening);
        }
      });
      return lim;
    },

    /* ---------------- Cell Pitch 카드 ---------------- */

    _buildPitchCard() {
      document.getElementById("pitchResult").innerHTML = `
        <div class="pitch-big">
          <span class="pitch-label">Cell Pitch <small>조립 기하 기준</small></span>
          <span class="pitch-value" id="pvPitch">-</span>
        </div>
        <div class="calc-rows">
          <div class="calc-row"><span>Anode &nbsp;조립높이 <small>P(A)</small></span><b id="pvSideA">-</b></div>
          <div class="calc-row"><span>Cathode 조립높이 <small>P(C)</small></span><b id="pvSideC">-</b></div>
          <div class="calc-row"><span>CCM 중앙 편심 <small>+ 는 Cathode 쪽</small></span><b id="pvOffset">-</b></div>
          <div class="calc-row"><span>CCM 총 두께 (Cat+Mem+Cat)</span><b id="pvCcm">-</b></div>
          <div class="calc-row"><span>Groove 삽입 (Anode / Cathode)</span><b id="pvGrv">-</b></div>
          <div class="calc-row info"><span>층 두께 단순 합 <small>참고 · 병렬 경로를 직렬로 더한 값</small></span><b id="pvTotal">-</b></div>
        </div>
        <div class="diag-list" id="pvDiag"></div>
        <div class="pitch-targets">
          <div class="meta-field">
            <label>목표 Cell Pitch (mm)</label>
            <input type="number" step="any" min="0" id="pvTargetPitch" placeholder="예: 7.75" />
          </div>
          <div class="meta-field">
            <label>스택 층수 (N)</label>
            <input type="number" step="1" min="1" id="pvStackN" />
          </div>
        </div>
        <div class="calc-rows" id="pvDerived"></div>`;

      const bind = (id, field) => {
        document.getElementById(id).addEventListener("input", (e) => {
          if (!this.design) return;
          this.design.targets[field] = Number(e.target.value) || 0;
          this.persist();
          this.renderPitch(false);
        });
      };
      bind("pvTargetPitch", "pitch");
      bind("pvStackN", "stackCount");
    },

    renderPitch(syncInputs = true) {
      if (!this.design) return;
      const { total, grvA, grvC, pitch, ccm, asm } = this.computePitch();
      const t = this.design.targets;

      const mm = (um, dd = 3) => `${(um / 1000).toFixed(dd)} mm`;
      const sideTxt = (Lx) => {
        const rem = Lx.maxBend - Lx.bend;
        const tag = Lx.slack > 0.5 ? ` <em class="warn">공극 ${mm(Lx.slack)}</em>`
          : rem > 0.5 ? ` <em class="warn">촉매까지 ${mm(rem)}</em>`
            : ` <em class="ok">완전 접촉</em>`;
        return `${mm(Lx.P)}${tag}`;
      };
      const off = asm.ccmOffset;
      document.getElementById("pvPitch").textContent = mm(pitch);
      document.getElementById("pvSideA").innerHTML = sideTxt(asm.LA);
      document.getElementById("pvSideC").innerHTML = sideTxt(asm.LC);
      document.getElementById("pvOffset").innerHTML = Math.abs(off) < 0.5
        ? `중앙 <em class="ok">대칭</em>`
        : `${off > 0 ? "+" : "−"}${mm(Math.abs(off))} <em class="warn">${off > 0 ? "Cathode" : "Anode"} 쪽</em>`;
      document.getElementById("pvCcm").textContent = `${ccm} μm`;
      document.getElementById("pvGrv").textContent = `${mm(grvA, 1)} / ${mm(grvC, 1)}`;
      document.getElementById("pvTotal").innerHTML =
        `${mm(total)} <small>(+${mm(total - pitch)})</small>`;

      // 설계 진단
      const diags = this.diagnose();
      document.getElementById("pvDiag").innerHTML = diags.length
        ? diags.map((x) => `<div class="diag ${x.level}">
            <i class="bi ${x.level === "error" ? "bi-x-octagon-fill" : "bi-exclamation-triangle-fill"}"></i>
            <span>${Utils.escapeHtml(x.text)}</span></div>`).join("")
        : `<div class="diag ok"><i class="bi bi-check-circle-fill"></i><span>기하 이상 없음 - 모든 층이 빈틈없이 맞물립니다.</span></div>`;

      if (syncInputs) {
        document.getElementById("pvTargetPitch").value = t.pitch || "";
        document.getElementById("pvStackN").value = t.stackCount || "";
      }
      this._syncCompressionUI();

      const rows = [];
      if (t.pitch > 0) {
        const targetUm = t.pitch * 1000;
        const diff = pitch - targetUm;
        rows.push(`<div class="calc-row ${Math.abs(diff) < 1 ? "ok" : ""}">
          <span>목표 대비 오차</span><b>${diff >= 0 ? "+" : ""}${diff.toFixed(0)} μm</b></div>`);
        if (diff > 0) {
          // 목표 Pitch 에 도달하려면 필요한 추가 압축률
          const need = this._compressionForPitch(targetUm);
          rows.push(`<div class="calc-row"><span>목표 Pitch 달성 압축률</span><b>${
            need == null ? "도달 불가 (강체 한계)" : `${need.toFixed(1)} %`}</b></div>`);
        }
      }
      if (t.stackCount > 0) {
        rows.push(`<div class="calc-row info"><span>${t.stackCount}층 스택 높이 (pitch × N)</span>
          <b>${((pitch * t.stackCount) / 1000).toFixed(1)} mm</b></div>`);
      }
      document.getElementById("pvDerived").innerHTML = rows.join("");
    },

    /* ============================================================
     * SVG 단면도 (실비율 조립도)
     * ============================================================ */

    renderSVG() {
      const svg = document.getElementById("xsecSvg");
      if (!this.design || !this.meaId) { svg.innerHTML = ""; return; }

      const d = this.design;
      const vis = (k) => !d.hidden[k] && d.slots[k];
      const S = (k) => d.slots[k];
      const th = (k) => (vis(k) ? d.slots[k].th : 0);
      const esc = Utils.escapeHtml;
      const asm = this.computeAssembly();
      if (asm.totalAsm <= 0) { svg.innerHTML = ""; return; }

      /* ----- 좌표계 -----
       * 세로 배율(ys)은 "압축 0% 기준"으로 한 번 정해 고정한다.
       * 매번 현재 높이에 맞춰 다시 계산하면, 압축으로 줄어든 만큼 나머지
       * 층이 커져 보여서 무엇이 눌린 건지 알 수 없게 된다.
       * 배율을 고정하면 눌린 층만 실제로 줄어들고 나머지는 그대로다.
       */
      const W = 820, H = 770;
      const PAD = { top: 24, bottom: 24, left: 14, labelZone: 150 };
      const plotW = W - PAD.left - PAD.labelZone - 8;
      const boxPx = H - PAD.top - PAD.bottom;

      const bpAth = vis("bpA") ? S("bpA").th : 0;
      const bpCth = vis("bpC") ? S("bpC").th : 0;
      const ref = this.computeAssembly(0);                    // 비압축 기준 형상
      const refInner = Math.max(ref.LA.P + th("mem") + ref.LC.P, 1);

      // BP 표시 높이 (표시 전용 - 계산에는 영향 없음)
      let bpPxA, bpPxC;
      if (d.bpView === "min") {
        bpPxA = bpAth > 0 ? BP_MIN_PX : 0;
        bpPxC = bpCth > 0 ? BP_MIN_PX : 0;
      } else {
        const k = d.bpView === "half" ? 0.5 : 1;
        const ysTmp = boxPx / (refInner + (bpAth + bpCth) * k);
        bpPxA = bpAth * k * ysTmp;
        bpPxC = bpCth * k * ysTmp;
      }
      const ys = Math.max(boxPx - bpPxA - bpPxC, 1) / refInner;  // px / μm (고정)

      // 압축으로 줄어든 만큼 도면이 짧아진다. 위아래에서 모여들도록 중앙 정렬.
      const innerNow = asm.LA.P + th("mem") + asm.LC.P;
      const drawnH = bpPxA + innerNow * ys + bpPxC;
      const topY = PAD.top + Math.max(boxPx - drawnH, 0) / 2;

      // BP 를 축약해 그리면 홈도 얕게 그려진다. 홈에 잠긴 층을 여기에 맞춰 자른다.
      const grooveDrawA = Math.min(asm.LA.grooveUsed * ys, bpPxA * 0.7);
      const grooveDrawC = Math.min(asm.LC.grooveUsed * ys, bpPxC * 0.7);
      const maxMm = Math.max(
        ...d.order.filter(vis).map((k) => S(k).outer || S(k).w || 0), 60);
      const xs = plotW / maxMm;                               // px / mm
      const cx = PAD.left + plotW / 2;

      const css = getComputedStyle(document.documentElement);
      const textColor = css.getPropertyValue("--text").trim() || "#1d2b3a";
      const subColor = css.getPropertyValue("--text-sub").trim() || "#64748b";
      const cardColor = css.getPropertyValue("--card-bg").trim() || "#ffffff";

      const parts = [];
      const labels = [];
      parts.push(`<defs>
        <pattern id="meshHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#8fc9f2"/><line x1="0" y1="0" x2="0" y2="7" stroke="#5da4dd" stroke-width="2.2"/>
        </pattern>
        <pattern id="gapHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="none"/><line x1="0" y1="0" x2="0" y2="6" stroke="#e5484d" stroke-width="1.6"/>
        </pattern>
      </defs>`);

      /** 중앙 정렬 판 형상. 최소 높이 보정을 하지 않는다(실비율 유지). */
      const rectC = (wMm, y, hPx, fill, extra = "") => {
        const w = Math.max(wMm, 0) * xs;
        const h = Math.max(hPx, 0);
        if (w <= 0 || h <= 0) return "";
        return `<rect x="${(cx - w / 2).toFixed(1)}" y="${y.toFixed(2)}" width="${w.toFixed(1)}" height="${h.toFixed(2)}" fill="${fill}" ${extra}/>`;
      };
      // 막 폭(mm)·막 반두께(μm). 서브가스켓 pinch 에서 사용.
      const memWmm = vis("mem") ? S("mem").w : null;
      const memBendUm = vis("mem") ? th("mem") / 2 : 0;

      /**
       * 서브가스켓 링 - 막과 hot pressing 되어 벌어질 수 없다.
       *
       * 막이 없는 바깥 구간에서 두 서브가스켓이 맞닿고, 그 면이 가스켓 위에
       * 그대로 얹힌다(= 기준 위치). 막이 잡힌 안쪽 구간은 두께를 유지한 채
       * 막 두께의 절반만큼 BP 쪽으로 밀려난다.
       *   막 바깥 : 서브 200 + 서브 200        = 400μm ← 가스켓과 맞닿는 면
       *   막 구간 : 서브 200 + 막 80 + 서브 200 = 480μm
       */
      const pinchFrame = (outerMm, openMm, memMm, y, hPx, side, fill, extra = "") => {
        const h = Math.max(hPx, 0);
        const xI = (openMm / 2) * xs;
        const xM = (Math.min(Math.max(memMm, openMm), outerMm) / 2) * xs;
        const xO = (outerMm / 2) * xs;
        if (h <= 0 || xO <= xI) return "";
        // 막을 잡은 안쪽 구간이 BP 쪽(= CCM 반대)으로 밀려난다
        const dir = side === "A" ? 1 : -1;
        const b = -(memBendUm || 0) * ys * dir;
        const n = (v) => v.toFixed(2);
        const b0 = y, b1 = y + h;                 // 막 바깥 구간 (가스켓과 맞닿음)
        const y0 = y + b, y1 = y + h + b;         // 막 구간 (두께 동일, BP 쪽으로 밀림)
        // 막이 개구부만큼만 넓으면 잡히는 구간이 없다 → 팔 전체가 기준 위치
        if (xM - xI < 0.5) {
          const flat = (g) => `M${n(cx + g * xI)},${n(b0)} L${n(cx + g * xO)},${n(b0)} ` +
            `L${n(cx + g * xO)},${n(b1)} L${n(cx + g * xI)},${n(b1)} Z`;
          return `<path d="${flat(1)} ${flat(-1)}" fill="${fill}" ${extra}/>`;
        }
        const tr = Math.min((xM - xI) * 0.25, Math.abs(b) * 0.9 + 0.4);
        const arm = (g) => `M${n(cx + g * xI)},${n(y0)} L${n(cx + g * (xM - tr))},${n(y0)} ` +
          `L${n(cx + g * (xM + tr))},${n(b0)} L${n(cx + g * xO)},${n(b0)} ` +
          `L${n(cx + g * xO)},${n(b1)} L${n(cx + g * (xM + tr))},${n(b1)} ` +
          `L${n(cx + g * (xM - tr))},${n(y1)} L${n(cx + g * xI)},${n(y1)} Z`;
        return `<path d="${arm(1)} ${arm(-1)}" fill="${fill}" ${extra}/>`;
      };

      /** 개구부가 뚫린 링 형상 (좌우 팔 2개) */
      const rectFrame = (outerMm, openMm, y, hPx, fill, extra = "") => {
        const armW = ((outerMm - openMm) / 2) * xs;
        const h = Math.max(hPx, 0);
        if (armW <= 0 || h <= 0) return "";
        const xL = cx - (outerMm / 2) * xs;
        const xR = cx + (openMm / 2) * xs;
        return `<rect x="${xL.toFixed(1)}" y="${y.toFixed(2)}" width="${armW.toFixed(1)}" height="${h.toFixed(2)}" fill="${fill}" ${extra}/>
                <rect x="${xR.toFixed(1)}" y="${y.toFixed(2)}" width="${armW.toFixed(1)}" height="${h.toFixed(2)}" fill="${fill}" ${extra}/>`;
      };
      const addLabel = (yC, text, color) => labels.push({ y: yC, text, color });

      /**
       * 뒤에서 밀려 개구부 안으로 들어간 층 - 두께는 그대로, 접시처럼 휜다.
       *
       * 개구부 안쪽(중앙)은 [y, y+h] 에 있고, 개구부 바깥(테두리)은 링에
       * 얹혀 bendPx 만큼 BP 쪽으로 뒤처진다. 두 면이 함께 이동하므로
       * 두께는 어디서나 h 로 같다. 압축 전(bendPx=0)에는 평평한 사각형.
       *
       * @param {number} stepMm - 휨이 시작되는 반경(지름 mm). 이 안쪽이 중앙부.
       */
      const bentLayer = (wMm, stepMm, y, hPx, bendPx, side, fill, extra = "") => {
        const x1 = (Math.max(wMm, stepMm) / 2) * xs;  // 바깥 반폭
        const x0 = Math.min((stepMm / 2) * xs, x1);   // 휨 경계 반폭
        const h = Math.max(hPx, 0);
        if (h <= 0 || x1 <= 0) return "";
        const dir = side === "A" ? 1 : -1;            // CCM 을 향하는 화면 방향
        const b = bendPx * dir;                       // 중앙이 CCM 쪽으로 간 양
        const tr = Math.min(x0 * 0.14, Math.abs(b) * 0.9 + 0.5); // 모서리 기울기
        const n = (v) => v.toFixed(2);
        // 중앙부 두 면
        const yc0 = y, yc1 = y + h;
        // 테두리 두 면 - 중앙보다 bend 만큼 BP 쪽으로 뒤처진다 (두께 동일)
        const yr0 = y - b, yr1 = y + h - b;
        return `<path d="M${n(cx - x1)},${n(yr0)} L${n(cx - x0 - tr)},${n(yr0)} ` +
          `L${n(cx - x0 + tr)},${n(yc0)} L${n(cx + x0 - tr)},${n(yc0)} ` +
          `L${n(cx + x0 + tr)},${n(yr0)} L${n(cx + x1)},${n(yr0)} ` +
          `L${n(cx + x1)},${n(yr1)} L${n(cx + x0 + tr)},${n(yr1)} ` +
          `L${n(cx + x0 - tr)},${n(yc1)} L${n(cx - x0 + tr)},${n(yc1)} ` +
          `L${n(cx - x0 - tr)},${n(yr1)} L${n(cx - x1)},${n(yr1)} Z" ` +
          `fill="${fill}" ${extra}/>`;
      };

      /** BP 축약 표시용 파단선 (중앙을 가로지르는 지그재그) */
      const breakMark = (yMid, halfWpx) => {
        const step = 9, amp = 3.2;
        let dstr = `M${(cx - halfWpx).toFixed(1)},${yMid.toFixed(1)}`;
        for (let x = cx - halfWpx, i = 0; x < cx + halfWpx; x += step, i++) {
          dstr += ` L${Math.min(x + step / 2, cx + halfWpx).toFixed(1)},${(yMid + (i % 2 ? amp : -amp)).toFixed(1)}`;
          dstr += ` L${Math.min(x + step, cx + halfWpx).toFixed(1)},${yMid.toFixed(1)}`;
        }
        return `<path d="${dstr}" fill="none" stroke="${cardColor}" stroke-width="2.4" opacity="0.9"/>`;
      };

      /**
       * BP 를 "홈이 실제로 절단된" path 로 그린다.
       * 배경색 사각형을 덧칠하던 기존 방식은 판재와 가스켓이 같은 공간을
       * 차지해(겹침) 물리적으로 성립하지 않았다.
       * notch 의 x 범위는 홈에 들어가는 프레임 층의 팔과 정확히 일치시킨다.
       */
      const bpPath = (yTop, hPx, bpWmm, notch, side) => {
        const bw = (bpWmm / 2) * xs;
        const xL = cx - bw, xR = cx + bw;
        const y0 = yTop, y1 = yTop + hPx;
        const n = (v) => v.toFixed(2);
        if (!notch || notch.gPx <= 0.01 || notch.oMm <= notch.iMm) {
          return `M${n(xL)},${n(y0)} L${n(xR)},${n(y0)} L${n(xR)},${n(y1)} L${n(xL)},${n(y1)} Z`;
        }
        const i = Math.min(notch.iMm, bpWmm / 2) * xs;
        const o = Math.min(notch.oMm, bpWmm / 2) * xs;
        const g = notch.gPx;
        if (side === "A") {
          // 홈은 CCM 을 향한 아래쪽 모서리
          return `M${n(xL)},${n(y0)} L${n(xR)},${n(y0)} L${n(xR)},${n(y1)} ` +
            `L${n(cx + o)},${n(y1)} L${n(cx + o)},${n(y1 - g)} L${n(cx + i)},${n(y1 - g)} L${n(cx + i)},${n(y1)} ` +
            `L${n(cx - i)},${n(y1)} L${n(cx - i)},${n(y1 - g)} L${n(cx - o)},${n(y1 - g)} L${n(cx - o)},${n(y1)} ` +
            `L${n(xL)},${n(y1)} Z`;
        }
        // 홈은 CCM 을 향한 위쪽 모서리
        return `M${n(xL)},${n(y1)} L${n(xR)},${n(y1)} L${n(xR)},${n(y0)} ` +
          `L${n(cx + o)},${n(y0)} L${n(cx + o)},${n(y0 + g)} L${n(cx + i)},${n(y0 + g)} L${n(cx + i)},${n(y0)} ` +
          `L${n(cx - i)},${n(y0)} L${n(cx - i)},${n(y0 + g)} L${n(cx - o)},${n(y0 + g)} L${n(cx - o)},${n(y0)} ` +
          `L${n(xL)},${n(y0)} Z`;
      };

      /**
       * 한쪽 면의 프레임/전극/밴드를 오프셋 → 화면 y 로 변환해 그린다.
       * @param {number} grooveDrawPx - BP 표시 높이에 맞춰 실제로 그려진 홈 깊이.
       *   BP 를 축약해 그리면 홈도 얕아지므로, 홈에 잠긴 부분을 여기에 맞춰
       *   잘라내야 판재 위로 삐져나가지 않는다.
       */
      const drawSide = (Lx, side, basePx, grooveDrawPx) => {
        // 오프셋 o(BP 면 기준, CCM 방향 +) → 화면 y
        const yOf = side === "A"
          ? (o, th) => basePx + o * ys
          : (o, th) => basePx - (o + th) * ys;
        // 홈 안으로 들어간 부분은 그려진 홈 깊이까지만 표시한다
        const minOff = -(grooveDrawPx || 0) / ys;
        const clampSpan = (pos, th) => {
          const s = Math.max(pos, minOff);
          return { pos: s, th: Math.max(pos + th - s, 0) };
        };

        // 공칭 대비 눌린 층에는 압축량을 함께 표시
        const compTag = (k) => {
          const sq = S(k).th - Lx.effTh[k];
          return sq > 0.5 ? ` · −${((sq / S(k).th) * 100).toFixed(1)}%` : "";
        };

        // 프레임 경로
        Lx.frameKeys.forEach((k, fi) => {
          const s = S(k), meta = this.meta(k);
          const sp = clampSpan(Lx.framePos[k], Lx.effTh[k]);
          const th = sp.th;
          const y = yOf(sp.pos, th), h = th * ys;
          // 가장 CCM 쪽 링(서브가스켓)은 막 바깥 구간에서 반대쪽과 맞닿는다
          const innermost = fi === Lx.frameKeys.length - 1;
          if (innermost && memWmm != null && s.outer > memWmm + 0.01) {
            parts.push(pinchFrame(s.outer, s.opening, memWmm, y, h, side, meta.color,
              `data-shape="frame" data-key="${esc(k)}"`));
          } else {
            parts.push(rectFrame(s.outer, s.opening, y, h, meta.color, `data-shape="frame" data-key="${esc(k)}"`));
          }
          const inGroove = Lx.frameKeys[0] === k && Lx.grooveUsed > 0 ? " ⌐홈" : "";
          addLabel(y + h / 2,
            `${meta.label} · ${fmtUm(s.th)} · ø${s.opening}${inGroove}${compTag(k)}`,
            meta.color === "#e6c229" ? "#c9a716" : meta.color);
        });

        // 전극 경로
        Lx.elecKeys.forEach((k) => {
          const s = S(k), meta = this.meta(k), th = Lx.effTh[k];
          const y = yOf(Lx.elecPos[k], th), h = th * ys;
          const outerOpening = Lx.frameKeys.length ? S(Lx.frameKeys[0]).opening : null;
          const hard = outerOpening != null && s.w > outerOpening;
          // 링에 걸린 층은 테두리가 링 위에 얹힌 상태로 그려지므로(bentLayer)
          // 폭을 자르면 안 된다 - 개구부 밖 부분이 사라져 보이는 원인이었다.
          const onRing = !!(Lx.blockedBy && Lx.blockedBy[k]);
          const lim = onRing ? null : this._openingAt(Lx, k);
          const wMm = Math.min(s.w, hard ? outerOpening : Infinity, lim == null ? Infinity : lim);
          const pinched = wMm < s.w - 0.01;
          const name = k.startsWith("ptl") ? (s.kind === "PTL" ? "PTL" : "GDL")
            : (s.custom ? s.label : meta.label);
          const fill = k.startsWith("mesh") ? "url(#meshHatch)" : meta.color;
          const stroke = pinched ? "#e5484d" : (k.startsWith("mesh") ? "#5da4dd" : "#8d939e");
          const attr = `stroke="${stroke}" stroke-width="${pinched ? 1 : 0.5}" data-shape="elec" data-key="${esc(k)}"`;

          const bk = (Lx.bendOf && Lx.bendOf[k]) || 0;
          const ringK = Lx.blockedBy && Lx.blockedBy[k];
          if (ringK && (bk > 0.5 || s.w > S(ringK).opening + 0.01)) {
            // 뒤 층에 밀려 개구부 안으로 들어간 상태 - 두께는 그대로 유지된다
            parts.push(bentLayer(wMm, S(ringK).opening, y, h, bk * ys, side, fill, attr));
            addLabel(y + h / 2,
              `${esc(name)} · ${fmtUm(s.th)} · ${s.w}mm · 휨 ${fmtUm(bk)}${compTag(k)}`,
              k.startsWith("mesh") ? "#5da4dd" : meta.color);
          } else {
            parts.push(rectC(wMm, y, h, fill, attr));
            addLabel(y + h / 2,
              `${esc(name)} · ${fmtUm(s.th)} · ${s.w}mm${pinched ? ` ⚠ ${wMm}mm 로 눌림` : ""}${compTag(k)}`,
              pinched ? "#e5484d" : (k.startsWith("mesh") ? "#5da4dd" : meta.color));
          }
        });

        // 불일치 밴드 (공극 / 간섭) - 숨기지 않고 명시한다
        Lx.bands.forEach((b) => {
          const th = b.e - b.s;
          const y = yOf(b.s, th), h = th * ys;
          if (b.path === "elec") {
            const wMm = Lx.minOpening != null ? Lx.minOpening : maxMm * 0.8;
            parts.push(rectC(wMm, y, h, "url(#gapHatch)",
              `stroke="#e5484d" stroke-width="0.8" stroke-dasharray="4 2" data-shape="band"`));
          } else {
            const f = S(Lx.frameKeys[Lx.frameKeys.length - 1]) || { outer: maxMm, opening: maxMm * 0.9 };
            parts.push(rectFrame(f.outer, f.opening, y, h, "url(#gapHatch)",
              `stroke="#e5484d" stroke-width="0.8" stroke-dasharray="4 2" data-shape="band"`));
          }
          addLabel(y + h / 2, b.text, "#e5484d");
        });
      };

      /* ---------- 위 = Cathode, 아래 = Anode ----------
       * drawSide/bentLayer 의 "A"/"C" 인자는 그리는 방향(아래로/위로)이고,
       * 어느 전극이 위에 오는지는 여기서 정한다.
       * DOWN = 화면 아래쪽으로 자라는 면, UP = 위쪽으로 자라는 면. */
      const DOWN = "A", UP = "C";
      const TOP = { key: "C", L: asm.LC, bpKey: "bpC", catKey: "catC", bpPx: bpPxC, groove: grooveDrawC, label: "Cathode" };
      const BOT = { key: "A", L: asm.LA, bpKey: "bpA", catKey: "catA", bpPx: bpPxA, groove: grooveDrawA, label: "Anode" };

      const bpTag = d.bpView === "min" ? " ✂" : d.bpView === "half" ? " ✂½" : "";

      /* ---------- 위쪽 BP ---------- */
      let topBpBot = topY;
      if (vis(TOP.bpKey)) {
        const s = S(TOP.bpKey), h = TOP.bpPx;
        const f0 = TOP.L.frameKeys[0];
        const notch = f0
          ? { iMm: S(f0).opening / 2, oMm: S(f0).outer / 2, gPx: TOP.groove }
          : null;
        parts.push(`<path data-shape="bp" d="${bpPath(topY, h, s.w, notch, DOWN)}" fill="${SLOT_META[TOP.bpKey].color}" stroke="#3d4653" stroke-width="0.6"/>`);
        if (d.bpView !== "full") parts.push(breakMark(topY + h * 0.35, (s.w / 2) * xs));
        addLabel(topY + h / 2,
          `${TOP.label} BP · ${fmtUm(s.th)} · G${fmtUm(s.groove)}${bpTag}`,
          SLOT_META[TOP.bpKey].color);
        topBpBot = topY + h;
      }

      drawSide(TOP.L, DOWN, topBpBot, TOP.groove);

      /* ---------- CCM ---------- */
      const memTop = topBpBot + TOP.L.P * ys;
      if (vis(TOP.catKey)) {
        const c = S(TOP.catKey), h = c.th * ys;
        parts.push(rectC(c.w, memTop - h, h, SLOT_META[TOP.catKey].color, `data-shape="ccm" data-key="${TOP.catKey}"`));
        addLabel(memTop - h / 2, `Catalyst (${TOP.label}) · ${fmtUm(c.th)} · ${c.w}mm`, SLOT_META[TOP.catKey].color);
      }
      let memBot = memTop;
      if (vis("mem")) {
        const m = S("mem"), h = m.th * ys;
        parts.push(rectC(m.w, memTop, h, SLOT_META.mem.color, `stroke="#aeb4bd" stroke-width="0.5" data-shape="ccm" data-key="mem"`));
        addLabel(memTop + h / 2, `Membrane · ${fmtUm(m.th)} · ${m.w}mm`, "#aeb4bd");
        memBot = memTop + h;
      }
      if (vis(BOT.catKey)) {
        const c = S(BOT.catKey), h = c.th * ys;
        parts.push(rectC(c.w, memBot, h, SLOT_META[BOT.catKey].color, `data-shape="ccm" data-key="${BOT.catKey}"`));
        addLabel(memBot + h / 2, `Catalyst (${BOT.label}) · ${fmtUm(c.th)} · ${c.w}mm`, SLOT_META[BOT.catKey].color);
      }

      /* ---------- 아래쪽 (거울) ---------- */
      const botBpTop = memBot + BOT.L.P * ys;
      drawSide(BOT.L, UP, botBpTop, BOT.groove);

      if (vis(BOT.bpKey)) {
        const s = S(BOT.bpKey), h = BOT.bpPx;
        const f0 = BOT.L.frameKeys[0];
        const notch = f0
          ? { iMm: S(f0).opening / 2, oMm: S(f0).outer / 2, gPx: BOT.groove }
          : null;
        parts.push(`<path data-shape="bp" d="${bpPath(botBpTop, h, s.w, notch, UP)}" fill="${SLOT_META[BOT.bpKey].color}" stroke="#3d4653" stroke-width="0.6"/>`);
        if (d.bpView !== "full") parts.push(breakMark(botBpTop + h * 0.65, (s.w / 2) * xs));
        addLabel(botBpTop + h / 2,
          `${BOT.label} BP · ${fmtUm(s.th)} · G${fmtUm(s.groove)}${bpTag}`,
          SLOT_META[BOT.bpKey].color);
      }

      /* ---------- 라벨 (우측, y 정렬 후 스태거) ---------- */
      // 라벨이 도면 아래로 넘치지 않도록 간격을 남은 높이에 맞춰 줄인다
      labels.sort((a, b) => a.y - b.y);
      const labelX = PAD.left + plotW + 14;
      const gapMin = Math.min(13.5, Math.max(8, (H - PAD.top - 10) / Math.max(labels.length, 1)));
      // 라벨 영역을 넘어가면 말줄임한다 (도면 밖으로 삐져나가지 않게)
      const LB_FONT = 10.5;
      const LB_ROOM = W - (labelX + 4) - 4;
      const fitLabel = (t) => {
        // 한글은 폭이 넓어 가중치를 다르게 준다
        const wOf = (str) => [...str].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 0.98 : 0.5), 0) * LB_FONT;
        if (wOf(t) <= LB_ROOM) return t;
        let cut = t;
        while (cut.length > 1 && wOf(cut + "…") > LB_ROOM) cut = cut.slice(0, -1);
        return cut + "…";
      };
      let lastY = -Infinity;
      labels.forEach((lb) => {
        const ly = Math.min(Math.max(lb.y, lastY + gapMin), H - 10);
        lastY = ly;
        parts.push(`<line x1="${(PAD.left + plotW + 2).toFixed(1)}" y1="${lb.y.toFixed(1)}" x2="${(labelX - 3).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${subColor}" stroke-width="0.5"/>`);
        parts.push(`<circle cx="${(labelX - 1).toFixed(1)}" cy="${ly.toFixed(1)}" r="2" fill="${lb.color}"/>`);
        parts.push(`<text x="${(labelX + 4).toFixed(1)}" y="${(ly + 3).toFixed(1)}" font-size="${LB_FONT}" fill="${textColor}" font-family="Segoe UI, sans-serif"><title>${lb.text}</title>${fitLabel(lb.text)}</text>`);
      });

      const viewTag = (d.compression > 0 ? `압축 ${Number(d.compression).toFixed(1)}%` : "비압축") +
        (d.bpView !== "full" ? " · BP 축약" : "") + " · 배율 고정";
      parts.push(`<text x="${PAD.left}" y="14" font-size="11" font-weight="bold" fill="${subColor}" font-family="Segoe UI, sans-serif">▲ CATHODE SIDE</text>`);
      parts.push(`<text x="${PAD.left}" y="${H - 8}" font-size="11" font-weight="bold" fill="${subColor}" font-family="Segoe UI, sans-serif">▼ ANODE SIDE</text>`);
      parts.push(`<text x="${W - 6}" y="14" font-size="10" fill="${subColor}" text-anchor="end" font-family="Segoe UI, sans-serif">${viewTag} · Pitch ${(asm.totalAsm / 1000).toFixed(3)} mm</text>`);

      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.innerHTML = parts.join("");
    },

    /* ============================================================
     * 내보내기
     * ============================================================ */

    saveJSON() {
      if (!this.design) return;
      const meaName = Storage.getMea(this.meaId)?.name || "design";
      const blob = new Blob(
        [JSON.stringify({ type: "cell-design", meaName, design: this.design }, null, 2)],
        { type: "application/json" });
      Utils.downloadBlob(blob, `CellDesign_${meaName.replace(/[\\/:*?"<>|]/g, "_")}_${Utils.fileTimestamp()}.json`);
      Utils.toast("설계를 JSON 으로 저장했습니다.");
    },

    loadJSON(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (parsed.type !== "cell-design" || !parsed.design?.slots) {
            throw new Error("Cell Design JSON 형식이 아닙니다.");
          }
          this.design = Object.assign(defaultDesign(), parsed.design);
          this.persist();
          this.renderAll();
          Utils.toast("설계를 불러왔습니다.");
        } catch (err) {
          Utils.toast("⚠ 불러오기 실패: " + err.message, 3500);
        }
      };
      reader.readAsText(file, "utf-8");
    },

    _svgBlob() {
      const svg = document.getElementById("xsecSvg");
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--card-bg").trim() || "#fff";
      clone.insertAdjacentHTML("afterbegin", `<rect width="100%" height="100%" fill="${bg}"/>`);
      return new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
    },

    exportSVG() {
      Utils.downloadBlob(this._svgBlob(), `CellLayer_${Utils.fileTimestamp()}.svg`);
      Utils.toast("SVG 로 저장했습니다.");
    },

    exportPNG() {
      const url = URL.createObjectURL(this._svgBlob());
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        // 하드코딩 대신 현재 viewBox 를 따라간다 (도면 높이가 바뀌어도 안 잘림)
        const vb = (document.getElementById("xsecSvg").getAttribute("viewBox") || "0 0 820 770")
          .split(/\s+/).map(Number);
        canvas.width = (vb[2] || 660) * 2;
        canvas.height = (vb[3] || 430) * 2;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (blob) {
            Utils.downloadBlob(blob, `CellLayer_${Utils.fileTimestamp()}.png`);
            Utils.toast("PNG 로 저장했습니다.");
          }
        }, "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(url); Utils.toast("⚠ PNG 변환 실패"); };
      img.src = url;
    },
  };

  document.addEventListener("page:changed", (e) => {
    if (e.detail.page === "page-layer") {
      try { LayerDesign.refresh(); }
      catch (err) { console.error("[LayerDesign] 갱신 실패:", err); }
    }
  });

  window.LayerDesign = LayerDesign;
})();
