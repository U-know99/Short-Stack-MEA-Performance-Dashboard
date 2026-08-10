/* ============================================================
 * storage.js - LocalStorage 기반 데이터 영속화 모듈
 *
 * [데이터 구조]
 * state = {
 *   version   : 스키마 버전 (향후 마이그레이션 대비)
 *   meta      : { date, operator, memo }              // 상단 헤더 입력
 *   meaList   : [ { id, name, conditions:{...} } ]    // MEA + MEA별 실험 조건
 *   selectedMeaId : 현재 선택된 MEA id
 *   experiments   : [ Experiment ]                    // 확정 저장된 실험들
 *   draft     : { meaId, rows:[...], elapsedSec }     // 진행 중 실험 자동 백업
 *   settings  : { theme, visibleSeries:{...} }        // UI 설정
 * }
 *
 * Experiment = {
 *   id, name("Experiment N"), meaId, meaName,
 *   date, operator, memo,
 *   conditions: { temperature, pressure, flowRate, activeArea, cellCount, remark },
 *   data: [ { time:"hh:mm:ss", elapsedSec, temperature, voltage,
 *             current, currentDensity, cellVoltage } ]
 * }
 * ============================================================ */
(function () {
  "use strict";

  const STORAGE_KEY = "ssmea_dashboard_v1"; // LocalStorage 키
  const SCHEMA_VERSION = 1;

  /* ============================================================
   * 내장 MEA 시드 데이터
   * 출처: MEA_1cell_성능평가_통합.xlsx > "3. 평가 목록 정리" 탭
   * 앱 최초 실행/업데이트 시 자동으로 MEA 목록에 등록된다.
   * (SEED_VERSION 을 올리면 새 항목이 기존 사용자에게도 추가됨)
   * ============================================================ */
  const SEED_VERSION = 2;
  const SEED_MEAS = [
    { name: "더카본스튜디오_WM50SDN15", specs: { vendor: "더카본스튜디오", membrane: "Nafion115", anodeCatalyst: "IrSnO2/TiO2", anodeLoading: 0.65, cathodeCatalyst: "Pt/C", cathodeLoading: 0.2, membraneThickness: 127, note: "Anode 함량 50 wt% · Cathode 함량 50 wt%" } },
    { name: "더카본스튜디오_WM50SDT10", specs: { vendor: "더카본스튜디오", membrane: "Gore + E-PTFE", anodeCatalyst: "IrSnO2/TiO2", anodeLoading: 0.65, cathodeCatalyst: "Pt/C", cathodeLoading: 0.2, membraneThickness: 80, note: "Anode 함량 50 wt% · Cathode 함량 50 wt%" } },
    { name: "비나텍_ELY SAMPLE / 250513-25F11", specs: { vendor: "비나텍", membrane: "고어", note: "수량 2 · 작년 샘플, 촉매 정보 요청 필요" } },
    { name: "비나텍_ELY SAMPLE / 250415-25D17", specs: { vendor: "비나텍", membrane: "고어", note: "수량 3" } },
    { name: "비나텍_라이트브릿지 SAMPLE / 260204-26B20", specs: { vendor: "비나텍", membrane: "Gore", anodeCatalyst: "IrO2/Ru", anodeLoading: 0.5, cathodeCatalyst: "Pt/C", cathodeLoading: 0.3, membraneThickness: 80, note: "수량 5 · 1-Cell 장비 260204" } },
    { name: "HEMT_라이트브릿지 3-Layer", specs: { vendor: "HEMT", membrane: "PFSA 막/강화막 (자체공급막)", anodeCatalyst: "IrO2/TiO₂", cathodeCatalyst: "Pt/C", membraneThickness: 80, note: "수량 10 · 자체 공급 막 · 로딩량/함량 요청 필요" } },
    { name: "보야스에너지_20250619", specs: { vendor: "보야스에너지", membrane: "고어", anodeCatalyst: "IrO2 (100%)", cathodeCatalyst: "Pt/C (H)", note: "수량 1 · 상세 정보 없음" } },
    { name: "웨스피_고어", specs: { vendor: "웨스피", membrane: "고어", note: "수량 500 · 상세 정보 없음" } },
    { name: "하이스케이프_고어막X D-type", specs: { vendor: "하이스케이프", membrane: "고어", anodePtl: "PTL 부착 (Anode쪽)", note: "수량 1 · sub-gasket X" } },
    { name: "하이스케이프_고어막O E-type", specs: { vendor: "하이스케이프", membrane: "고어", anodePtl: "PTL 부착 (Anode쪽)", note: "수량 2 · sub-gasket O" } },
    { name: "미확인(웨스피 예상)_PTL 부착 sample", specs: { vendor: "미확인/웨스피 예상", note: "수량 2 · 1EA는 PTL 한쪽만" } },
  ];

  /** 이전 버전에서 잘못 가져온 재고목록 MEA 이름 (자동 정리 대상) */
  const LEGACY_IMPORT_NAMES = [
    "더카본스튜디오_나피온_단차O_Wet", "더카본스튜디오_나피온_단차O_Dry", "더카본스튜디오_나피온_미개봉",
    "더카본스튜디오_고어_단차X_A급 Wet", "더카본스튜디오_고어_단차X_A급 Dry",
    "더카본스튜디오_고어_단차X_B급 Wet", "더카본스튜디오_고어_단차X_B급 Dry",
    "더카본스튜디오_고어_단차O_Wet", "더카본스튜디오_고어_단차O_Dry",
    "더카본스튜디오_고어_얇은 서브가스켓_Wet", "더카본스튜디오_고어_얇은 서브가스켓_Dry",
    "더카본스튜디오_고어_큰 가이드 구멍_Wet", "더카본스튜디오_고어_MEA 확장형",
    "웨스피_고어_단차X_Wet", "웨스피_고어_단차X_Dry", "웨스피_고어_단차O_Wet", "웨스피_고어_단차O_Dry",
    "보야스에너지_고어_단차O_Dry",
  ];

  /** 최초 실행 시 기본 상태 (예시 MEA 4개 포함) */
  function defaultState() {
    const mkMea = (name) => ({
      id: Utils.uid("mea"),
      name,
      status: "대기",  // 칸반보드 평가 상태 (대기/진행중/완료/보류)
      conditions: {}, // MEA별 실험 조건 (CONDITION_FIELDS 키로 채워짐)
      specs: {},      // MEA 제작 사양 (MEA_SPEC_FIELDS 키로 채워짐 - 모달에서 편집)
    });
    return {
      version: SCHEMA_VERSION,
      meta: { date: Utils.todayString(), operator: "", memo: "" },
      meaList: [mkMea("MEA-001"), mkMea("MEA-002"), mkMea("MEA-003"), mkMea("MEA-004")],
      selectedMeaId: null,
      experiments: [],
      cellDesigns: [],   // 이름 붙여 저장한 Layer 설계 라이브러리
      draft: null,
      settings: {
        theme: "light",
        // 그래프 표시 항목 기본값
        visibleSeries: {
          voltage: true,
          current: true,
          temperature: false,
          currentDensity: false,
          cellVoltage: false,
        },
        // IV Curve 축 기본값 (전류밀도-셀전압)
        ivAxes: { x: "currentDensity", y: "cellVoltage" },
      },
    };
  }

  const Storage = {

    /** 메모리 상 현재 상태 (단일 소스) */
    state: null,

    /** LocalStorage 에서 상태 로드. 없거나 손상 시 기본값 사용 */
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // 기본값과 병합해 누락 필드를 보완 (스키마 확장 대비)
          this.state = Object.assign(defaultState(), parsed);
          this.state.settings = Object.assign(defaultState().settings, parsed.settings || {});
        } else {
          this.state = defaultState();
        }
      } catch (err) {
        console.error("[Storage] 로드 실패, 기본값으로 초기화:", err);
        this.state = defaultState();
      }
      this._migrate();
      this._applySeed();
      return this.state;
    },

    /**
     * 시드 데이터 적용 (버전당 1회)
     * - 이전에 잘못 가져온 재고목록 MEA 는 삭제 (실험 기록이 있으면 유지)
     * - 엑셀 "평가 목록 정리" 기반 시드 MEA 를 추가 (이름 중복 제외)
     */
    _applySeed() {
      if ((this.state.seedVersion || 0) >= SEED_VERSION) return;

      // 1) 잘못 가져온 재고목록 정리
      const usedMeaIds = new Set((this.state.experiments || []).map((e) => e.meaId));
      this.state.meaList = this.state.meaList.filter(
        (m) => !(LEGACY_IMPORT_NAMES.includes(m.name) && !usedMeaIds.has(m.id))
      );
      if (this.state.selectedMeaId && !this.getMea(this.state.selectedMeaId)) {
        this.state.selectedMeaId = null;
      }

      // 2) 시드 MEA 추가
      const existingNames = new Set(this.state.meaList.map((m) => m.name));
      SEED_MEAS.forEach((seed) => {
        if (existingNames.has(seed.name)) return;
        this.state.meaList.push({
          id: Utils.uid("mea"),
          name: seed.name,
          status: "대기",
          conditions: {},
          specs: Utils.deepClone(seed.specs),
        });
      });

      this.state.seedVersion = SEED_VERSION;
      this.save();
    },

    /**
     * 구버전 데이터 마이그레이션
     * - specs 필드가 없는 MEA 에 빈 객체 보강
     * - activeArea : MEA 제작 사양 → specs 로 이동
     * - cellCount  : "평가 Cell 수"는 실험 조건 → conditions 로 이동
     */
    _migrate() {
      (this.state.meaList || []).forEach((mea) => {
        if (!mea.specs) mea.specs = {};
        if (!mea.conditions) mea.conditions = {};
        if (!mea.status) mea.status = "대기"; // 칸반 상태 기본값
        // activeArea: conditions → specs
        if (mea.conditions.activeArea !== undefined) {
          if (mea.specs.activeArea === undefined) mea.specs.activeArea = mea.conditions.activeArea;
          delete mea.conditions.activeArea;
        }
        // cellCount: specs → conditions (평가 조건이므로)
        if (mea.specs.cellCount !== undefined) {
          if (mea.conditions.cellCount === undefined) mea.conditions.cellCount = mea.specs.cellCount;
          delete mea.specs.cellCount;
        }
      });
      // 구버전 Experiment 에 실험 유형 기본값 부여
      (this.state.experiments || []).forEach((exp) => {
        if (!exp.type) exp.type = "stability";
      });
    },

    /** MEA 의 Layer 설계 저장 (Layer 설계 페이지) */
    updateMeaLayers(meaId, layers) {
      const mea = this.getMea(meaId);
      if (!mea) return;
      mea.layers = layers;
      this.save();
    },

    /** MEA 의 가스켓/스택 설정 저장 (목표 두께 계산기) */
    updateMeaGasket(meaId, gasket) {
      const mea = this.getMea(meaId);
      if (!mea) return;
      mea.gasket = Object.assign({}, mea.gasket, gasket);
      this.save();
    },

    /** MEA 의 Cell Layer 설계 저장 (PEM Cell Layer Designer) */
    updateMeaCellDesign(meaId, design) {
      const mea = this.getMea(meaId);
      if (!mea) return;
      mea.cellDesign = design;
      this.save();
    },

    /** 현재 상태를 LocalStorage 에 저장 */
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (err) {
        console.error("[Storage] 저장 실패:", err);
        Utils.toast("⚠ 저장 공간이 부족합니다. JSON으로 백업하세요.");
      }
    },

    /* ---------------- MEA 관리 ---------------- */

    /** MEA 추가 후 새 객체 반환 (specs: 제작 사양) */
    addMea(name, specs = {}) {
      const mea = { id: Utils.uid("mea"), name, status: "대기", conditions: {}, specs };
      this.state.meaList.push(mea);
      this.save();
      return mea;
    },

    /** 칸반 상태 변경 (드래그로 컬럼 이동 시) */
    updateMeaStatus(meaId, status) {
      const mea = this.getMea(meaId);
      if (!mea) return;
      mea.status = status;
      this.save();
    },

    /** MEA 제작 사양(specs) 갱신 (모달에서 저장 시) */
    updateMeaSpecs(meaId, specs) {
      const mea = this.getMea(meaId);
      if (!mea) return;
      mea.specs = Object.assign({}, mea.specs, specs);
      this.save();
    },

    /** MEA 삭제 */
    removeMea(meaId) {
      this.state.meaList = this.state.meaList.filter((m) => m.id !== meaId);
      if (this.state.selectedMeaId === meaId) this.state.selectedMeaId = null;
      this.save();
    },

    /** MEA 이름 변경 */
    renameMea(meaId, newName) {
      const mea = this.getMea(meaId);
      if (mea && newName.trim()) mea.name = newName.trim();
      this.save();
    },

    /** Drag & Drop 결과로 순서 재배치 (id 배열 순서대로) */
    reorderMea(orderedIds) {
      const map = new Map(this.state.meaList.map((m) => [m.id, m]));
      this.state.meaList = orderedIds.map((id) => map.get(id)).filter(Boolean);
      this.save();
    },

    /** id 로 MEA 찾기 */
    getMea(meaId) {
      return this.state.meaList.find((m) => m.id === meaId) || null;
    },

    /** 현재 선택된 MEA */
    getSelectedMea() {
      return this.getMea(this.state.selectedMeaId);
    },

    /** MEA 선택 */
    selectMea(meaId) {
      this.state.selectedMeaId = meaId;
      this.save();
    },

    /** 선택된 MEA 의 실험 조건 갱신 */
    updateConditions(partial) {
      const mea = this.getSelectedMea();
      if (!mea) return;
      mea.conditions = Object.assign({}, mea.conditions, partial);
      this.save();
    },

    /* ---------------- Experiment 관리 ---------------- */

    /**
     * 실험 확정 저장. "Experiment N" 이름 자동 부여.
     * @param {Array} rows - 측정 데이터 행 배열
     * @param {string} type - 실험 유형 "stability" | "iv"
     * @returns {object|null} 저장된 Experiment
     */
    saveExperiment(rows, type = "stability") {
      const mea = this.getSelectedMea();
      if (!mea || !rows.length) return null;
      const exp = {
        id: Utils.uid("exp"),
        name: `Experiment ${this.state.experiments.length + 1}`,
        type, // 안정성(stability) / IV 측정(iv)
        meaId: mea.id,
        meaName: mea.name,
        date: this.state.meta.date,
        operator: this.state.meta.operator,
        memo: this.state.meta.memo,
        conditions: Utils.deepClone(mea.conditions),
        specs: Utils.deepClone(mea.specs || {}), // 저장 시점의 MEA 제작 사양 스냅샷
        data: Utils.deepClone(rows),
        savedAt: new Date().toISOString(),
      };
      this.state.experiments.push(exp);
      this.save();
      return exp;
    },

    /** Experiment 이름 변경 */
    renameExperiment(expId, newName) {
      const exp = this.getExperiment(expId);
      if (exp && newName.trim()) exp.name = newName.trim();
      this.save();
    },

    /** Experiment 삭제 */
    removeExperiment(expId) {
      this.state.experiments = this.state.experiments.filter((e) => e.id !== expId);
      this.save();
    },

    getExperiment(expId) {
      return this.state.experiments.find((e) => e.id === expId) || null;
    },

    /**
     * 외부에서 파싱한 Experiment 들을 목록에 추가 (Excel 불러오기용)
     *
     * - MEA 는 이름으로 연결하고, 없으면 사양과 함께 새로 만든다
     * - 이름이 겹치면 " (2)" 처럼 번호를 붙여 기존 실험을 덮어쓰지 않는다
     * - 이름·측정행수·첫 시각이 모두 같은 실험은 중복으로 보고 건너뛴다
     *
     * @param {Array} incoming - parseXLSX 가 만든 Experiment 배열
     * @returns {{added:Array, skipped:Array, createdMeas:string[]}}
     */
    importExperiments(incoming) {
      const added = [], skipped = [], createdMeas = [];
      const sig = (e) => `${(e.name || "").trim()}|${(e.data || []).length}|${(e.data || [])[0]?.time || ""}`;
      const existing = new Set(this.state.experiments.map(sig));
      const usedNames = new Set(this.state.experiments.map((e) => (e.name || "").trim()));

      (incoming || []).forEach((raw) => {
        const exp = Utils.deepClone(raw);
        if (existing.has(sig(exp))) { skipped.push(exp.name); return; }

        // MEA 연결 (이름 일치 → 없으면 생성)
        const wanted = (exp.meaName || "").trim();
        let mea = wanted ? this.state.meaList.find((m) => m.name === wanted) : null;
        if (!mea && wanted) {
          mea = this.addMea(wanted, exp.specs || {});
          createdMeas.push(wanted);
        }
        if (mea) { exp.meaId = mea.id; exp.meaName = mea.name; }

        // 이름 중복 방지
        let name = (exp.name || "Experiment").trim(), n = 2;
        while (usedNames.has(name)) name = `${(exp.name || "Experiment").trim()} (${n++})`;
        exp.name = name;
        usedNames.add(name);

        exp.id = Utils.uid("exp");
        this.state.experiments.push(exp);
        existing.add(sig(exp));
        added.push(exp);
      });

      if (added.length) this.save();
      return { added, skipped, createdMeas };
    },

    /* ---------------- Cell 설계 라이브러리 ----------------
     * Layer 설계를 MEA 와 분리된 "템플릿"으로 이름 붙여 보관한다.
     * 불러오기는 현재 선택된 MEA 의 설계를 덮어쓴다.
     * ------------------------------------------------------ */

    /**
     * 현재 설계를 라이브러리에 저장
     * @param {string} name - 설계 이름
     * @param {object} design - LayerDesign.design 스냅샷
     * @param {string} meaName - 저장 시점의 MEA 이름 (참고 표시용)
     * @returns {object|null} 저장된 항목
     */
    saveCellDesign(name, design, meaName = "") {
      if (!design) return null;
      if (!Array.isArray(this.state.cellDesigns)) this.state.cellDesigns = [];
      const item = {
        id: Utils.uid("cd"),
        name: (name || "").trim() || `설계 ${this.state.cellDesigns.length + 1}`,
        meaName,
        design: Utils.deepClone(design),
        savedAt: new Date().toISOString(),
      };
      this.state.cellDesigns.push(item);
      this.save();
      return item;
    },

    /** 라이브러리 항목을 현재 설계로 덮어쓰기 (같은 이름 자리에 갱신) */
    updateCellDesign(id, design) {
      const item = this.getCellDesign(id);
      if (!item || !design) return null;
      item.design = Utils.deepClone(design);
      item.savedAt = new Date().toISOString();
      this.save();
      return item;
    },

    renameCellDesign(id, newName) {
      const item = this.getCellDesign(id);
      if (item && newName.trim()) item.name = newName.trim();
      this.save();
    },

    removeCellDesign(id) {
      this.state.cellDesigns = (this.state.cellDesigns || []).filter((c) => c.id !== id);
      this.save();
    },

    getCellDesign(id) {
      return (this.state.cellDesigns || []).find((c) => c.id === id) || null;
    },

    /* ---------------- 진행 중 실험 백업(draft) ---------------- */

    /** 입력 중 데이터를 수시로 백업 → 브라우저 재시작에도 복구 */
    saveDraft(draft) {
      this.state.draft = draft;
      this.save();
    },

    clearDraft() {
      this.state.draft = null;
      this.save();
    },

    /* ---------------- JSON 전체 백업 / 복원 ---------------- */

    /** 전체 상태를 JSON 직렬화 (JSON 저장 버튼) */
    exportJSON() {
      return JSON.stringify(this.state, null, 2);
    },

    /**
     * JSON 파일(전체 백업)로 상태 전체 복원 (불러오기 버튼)
     * 다른 컴퓨터에서도 동일한 대시보드 상태를 볼 수 있다.
     * @throws 파싱 실패 시 예외
     */
    importJSON(jsonText) {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.meaList)) {
        throw new Error("올바른 대시보드 JSON 형식이 아닙니다.");
      }
      this.state = Object.assign(defaultState(), parsed);
      this._migrate();   // 구버전 JSON 도 사양 구조로 변환
      this._applySeed(); // 구버전 백업이라면 시드도 반영
      this.save();
      return this.state;
    },
  };

  // 전역 노출
  window.Storage = Storage;
})();
