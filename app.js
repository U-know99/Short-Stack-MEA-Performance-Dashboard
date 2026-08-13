/* ============================================================
 * app.js - 메인 컨트롤러
 *
 * 모든 모듈(Utils/Storage/DataTable/LiveChart/Exporter)을 묶어
 * 화면 이벤트를 처리한다.
 *
 * [구성]
 *  1. 실험 조건 필드 정의 (CONDITION_FIELDS - 확장 지점)
 *  2. 실험 타이머 (Start/Pause/Resume/Stop)
 *  3. MEA 목록 (추가/삭제/이름수정/DnD 순서변경/선택)
 *  4. 측정 데이터 입력 → 테이블/그래프/draft 동기화
 *  5. Experiment 저장/불러오기/삭제
 *  6. 내보내기 버튼 연결
 *  7. 페이지 전환 / 테마 / 시계
 * ============================================================ */
(function () {
  "use strict";

  /* ============================================================
   * 1. 실험 조건 필드 정의 (확장 지점)
   * 새 조건이 필요하면 여기에 객체 한 개만 추가하면
   * 입력 UI / 저장 / Excel 내보내기까지 자동 반영된다.
   * ============================================================ */
  const CONDITION_FIELDS = [
    { key: "temperature", label: "Temperature (℃)", type: "number", placeholder: "ex) 80" },
    { key: "pressure",    label: "Pressure (bar)",  type: "number", placeholder: "ex) 1.0" },
    // Flow Rate: 단위를 mL/min(유량) 또는 V(모터 전압)로 선택.
    //  - 모터 전압을 수동으로 조절해 유량을 맞추는 경우 V 로 기록.
    { key: "flowRate",    label: "Flow Rate",       type: "number-unit",
      placeholder: "ex) 100", unitKey: "flowRateUnit", units: ["mL/min", "V"] },
    // 평가 Cell 수: MEA 사양이 아닌 "이번 평가를 몇 셀로 하는지" 조건.
    // 같은 Cell 수 실험끼리 데이터 분석 페이지에서 비교할 수 있다.
    { key: "cellCount",   label: "평가 Cell 수",      type: "select", options: [1, 3, 5], allowCustom: true },
    { key: "remark",      label: "Remark",           type: "text",   placeholder: "특이사항", full: true },
  ];

  /* ============================================================
   * MEA 제작 사양 필드 정의 (MEA 정보 모달 - 확장 지점)
   * section: 모달 안 구분 헤더, full: 두 칸 전체 사용
   * activeArea/cellCount 는 전류밀도·셀 전압 자동 계산에 사용된다.
   * ============================================================ */
  const MEA_SPEC_FIELDS = [
    { section: "기본 정보" },
    { key: "name",            label: "MEA 이름 *",             type: "text",   placeholder: "ex) MEA-001" },
    { key: "vendor",          label: "업체",                   type: "text",   placeholder: "ex) 더카본스튜디오" },
    { key: "fabricationDate", label: "제작일",                 type: "date" },
    { key: "activeArea",      label: "Active Area (cm²)",      type: "number", placeholder: "ex) 25 (전류밀도 계산)" },
    { section: "막 / 촉매" },
    { key: "membrane",        label: "Membrane",               type: "text",   placeholder: "ex) Nafion 115" },
    { key: "membraneThickness", label: "막 두께 (μm)",          type: "number", placeholder: "ex) 80" },
    { key: "anodeCatalyst",   label: "Anode 촉매",             type: "text",   placeholder: "ex) IrO₂" },
    { key: "anodeLoading",    label: "Anode Loading (mg/cm²)", type: "number", placeholder: "ex) 2.0" },
    { key: "cathodeCatalyst", label: "Cathode 촉매",           type: "text",   placeholder: "ex) Pt/C 40%" },
    { key: "cathodeLoading",  label: "Cathode Loading (mg/cm²)", type: "number", placeholder: "ex) 0.4" },
    { section: "확산층 / 기타" },
    { key: "anodePtl",        label: "Anode PTL",              type: "text",   placeholder: "ex) Ti felt" },
    { key: "cathodeGdl",      label: "Cathode GDL",            type: "text",   placeholder: "ex) Carbon paper" },
    { key: "note",            label: "비고",                   type: "text",   placeholder: "자유 메모", full: true },
  ];

  /* ============================================================
   * 앱 상태 (런타임 전용 - 저장은 Storage 가 담당)
   * ============================================================ */
  const app = {
    rows: [],            // 현재 실험의 측정 데이터
    runState: "idle",    // idle | running | paused | stopped
    startEpoch: 0,       // Start 시점 timestamp(ms)
    accumulated: 0,      // Pause 이전까지 누적된 경과(ms)
    timerId: null,       // 경과시간 갱신 interval
  };

  /** 자주 쓰는 DOM 요소 캐시 */
  const $ = (id) => document.getElementById(id);

  /* ============================================================
   * 2. 실험 타이머
   * ============================================================ */

  /** 현재 선택된 실험 유형 ("stability" | "iv") */
  function currentExpType() {
    return document.querySelector('input[name="expType"]:checked')?.value || "stability";
  }

  /** 현재 경과 시간(초) 계산 */
  function elapsedSeconds() {
    const runningMs = app.runState === "running" ? Date.now() - app.startEpoch : 0;
    return (app.accumulated + runningMs) / 1000;
  }

  /** 경과시간 표시 갱신 (0.5초 주기) */
  function tick() {
    $("elapsedTime").textContent = Utils.formatElapsed(elapsedSeconds());
  }

  /** 실행 상태에 따라 버튼 활성화/배지 갱신 */
  function applyRunState() {
    const s = app.runState;
    $("btnStart").disabled  = s === "running" || s === "paused";
    $("btnPause").disabled  = s !== "running";
    $("btnResume").disabled = s !== "paused";
    $("btnStop").disabled   = s === "idle" || s === "stopped";
    $("btnAddRow").disabled = s !== "running";

    const badge = $("runStateBadge");
    badge.classList.remove("running", "paused");
    if (s === "running") { badge.textContent = "측정 중"; badge.classList.add("running"); }
    else if (s === "paused") { badge.textContent = "일시정지"; badge.classList.add("paused"); }
    else if (s === "stopped") { badge.textContent = "종료됨"; }
    else { badge.textContent = "대기 중"; }
  }

  function startExperiment() {
    if (!Storage.getSelectedMea()) {
      Utils.toast("먼저 좌측에서 평가할 MEA를 선택하세요.");
      return;
    }
    app.runState = "running";
    app.startEpoch = Date.now();
    app.accumulated = 0;
    app.rows = [];
    DataTable.render(app.rows);
    LiveChart.update(app.rows);
    app.timerId = setInterval(tick, 500);
    tick();
    applyRunState();
    Utils.toast("실험을 시작합니다.");
  }

  function pauseExperiment() {
    if (app.runState !== "running") return;
    app.accumulated += Date.now() - app.startEpoch;
    app.runState = "paused";
    applyRunState();
  }

  function resumeExperiment() {
    if (app.runState !== "paused") return;
    app.startEpoch = Date.now();
    app.runState = "running";
    applyRunState();
  }

  /** Stop: 타이머 정지 + Experiment 자동 저장 */
  function stopExperiment() {
    if (app.runState === "idle" || app.runState === "stopped") return;
    if (app.runState === "running") app.accumulated += Date.now() - app.startEpoch;
    app.runState = "stopped";
    clearInterval(app.timerId);
    applyRunState();

    // Stop 시 자동 저장 (데이터가 있을 때만)
    if (app.rows.length) {
      const exp = Storage.saveExperiment(app.rows, currentExpType());
      Storage.clearDraft();
      renderExpList();
      Utils.toast(`실험 종료 - ${exp.name} 으로 자동 저장했습니다.`);
    } else {
      Utils.toast("실험을 종료했습니다. (저장할 데이터 없음)");
    }
  }

  /* ============================================================
   * 3. 평가 MEA Board (칸반: 상태별 컬럼 + Drag & Drop)
   * ============================================================ */

  /** 칸반 컬럼 정의 (확장 지점: 상태 추가 시 여기에 등록) */
  const STATUS_COLUMNS = [
    { key: "대기",   icon: "bi-hourglass",        cls: "st-wait" },
    { key: "진행중", icon: "bi-play-circle",      cls: "st-run"  },
    { key: "완료",   icon: "bi-check-circle",     cls: "st-done" },
    { key: "보류",   icon: "bi-pause-circle",     cls: "st-hold" },
  ];

  /**
   * 카드 표시용 이름 분해
   * 시드 데이터 이름은 "업체_제품명" 형식 → 업체 배지 + 제품명으로 분리
   */
  function splitMeaName(mea) {
    const vendor = (mea.specs?.vendor || "").trim();
    if (vendor && mea.name.startsWith(vendor + "_")) {
      return { vendor, product: mea.name.slice(vendor.length + 1) };
    }
    return { vendor, product: mea.name };
  }

  /** 칸반보드 전체 렌더링 (함수명은 기존 호출부 호환을 위해 유지) */
  function renderMeaList() {
    const board = $("kanbanBoard");
    const selectedId = Storage.state.selectedMeaId;
    const frag = document.createDocumentFragment();

    STATUS_COLUMNS.forEach((col) => {
      const meas = Storage.state.meaList.filter((m) => (m.status || "대기") === col.key);

      const colEl = document.createElement("div");
      colEl.className = `kanban-col ${col.cls}`;
      colEl.dataset.status = col.key;
      colEl.innerHTML = `
        <div class="kanban-col-head">
          <span><i class="bi ${col.icon}"></i> ${col.key}</span>
          <span class="kanban-count">${meas.length}</span>
        </div>
        <div class="kanban-cards" data-status="${col.key}"></div>`;

      const cardsEl = colEl.querySelector(".kanban-cards");
      meas.forEach((mea) => {
        const { vendor, product } = splitMeaName(mea);
        // 스티커 형태의 컴팩트 카드 (한 줄: 배지 + 제품명 + 버튼)
        const card = document.createElement("div");
        card.className = "mea-card" + (mea.id === selectedId ? " selected" : "");
        card.draggable = true;
        card.dataset.id = mea.id;
        card.title = mea.name; // 전체 이름은 툴팁으로
        card.innerHTML = `
          ${vendor ? `<span class="vendor-badge">${vendor}</span>` : ""}
          <span class="mea-card-name">${product}</span>
          <i class="bi bi-check-circle-fill sel-mark" title="현재 실험 대상"></i>
          <span class="mea-card-btns">
            <button class="mea-info" title="정보 보기/수정"><i class="bi bi-info-circle"></i></button>
            <button class="mea-del" title="삭제"><i class="bi bi-trash3"></i></button>
          </span>`;
        cardsEl.appendChild(card);
      });
      frag.appendChild(colEl);
    });

    board.replaceChildren(frag);
  }

  /** 칸반보드 이벤트 (위임 방식) */
  function bindMeaListEvents() {
    const board = $("kanbanBoard");

    // 클릭: 선택 / 정보 / 삭제
    board.addEventListener("click", (e) => {
      const card = e.target.closest(".mea-card");
      if (!card) return;

      if (e.target.closest(".mea-del")) {
        const mea = Storage.getMea(card.dataset.id);
        if (confirm(`'${mea.name}' 을(를) 삭제할까요?`)) {
          Storage.removeMea(card.dataset.id);
          renderMeaList();
          renderConditions();
        }
        return;
      }
      if (e.target.closest(".mea-info")) {
        openMeaModal(card.dataset.id);
        return;
      }
      // 카드 클릭 = 실험 대상 선택
      Storage.selectMea(card.dataset.id);
      renderMeaList();
      renderConditions();
    });

    // 더블클릭: MEA 정보 모달
    board.addEventListener("dblclick", (e) => {
      const card = e.target.closest(".mea-card");
      if (card) openMeaModal(card.dataset.id);
    });

    // ----- Drag & Drop : 컬럼 간 상태 변경 + 컬럼 내 순서 변경 -----
    let dragId = null;

    board.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".mea-card");
      if (!card) return;
      dragId = card.dataset.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    /**
     * 마우스 Y 좌표 기준으로 삽입할 위치(다음 카드)를 계산.
     * e.target 에 의존하지 않고 컬럼 내 모든 카드의 중심선과
     * 비교하므로, 카드 사이 틈/여백 위에서도 가장 가까운
     * 위치를 정확히 찾는다. (맨 밑으로 떨어지는 문제 해결)
     */
    function getDragAfterElement(zone, y) {
      const cards = [...zone.querySelectorAll(".mea-card:not(.dragging)")];
      let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
      for (const card of cards) {
        const box = card.getBoundingClientRect();
        const offset = y - box.top - box.height / 2; // 카드 중심선과의 거리
        if (offset < 0 && offset > closest.offset) closest = { offset, element: card };
      }
      return closest.element; // null 이면 맨 뒤
    }

    board.addEventListener("dragover", (e) => {
      e.preventDefault(); // drop 허용
      const dragging = board.querySelector(".mea-card.dragging");
      const zone = e.target.closest(".kanban-cards");
      if (!dragging || !zone) return;

      // 드롭 위치 표시 (변경 시에만 갱신)
      if (!zone.classList.contains("drag-over")) {
        board.querySelectorAll(".kanban-cards").forEach((z) => z.classList.remove("drag-over"));
        zone.classList.add("drag-over");
      }

      // 삽입 지점 계산 후, 실제로 위치가 바뀔 때만 DOM 이동
      // (매 이벤트마다 옮기면 레이아웃이 흔들려 깜빡임 발생)
      const after = getDragAfterElement(zone, e.clientY);
      const sameZone = dragging.parentNode === zone;
      if (sameZone && after === dragging.nextSibling) return; // 이미 올바른 위치
      if (after === null) {
        if (!sameZone || dragging.nextSibling !== null) zone.appendChild(dragging);
      } else {
        zone.insertBefore(dragging, after);
      }
    });

    board.addEventListener("dragend", () => {
      const dragging = board.querySelector(".mea-card.dragging");
      board.querySelectorAll(".kanban-cards").forEach((z) => z.classList.remove("drag-over"));
      if (dragging) dragging.classList.remove("dragging");
      if (!dragId) return;

      // 1) 드롭된 컬럼의 상태를 MEA 에 반영
      const zone = dragging?.closest(".kanban-cards");
      if (zone) Storage.updateMeaStatus(dragId, zone.dataset.status);

      // 2) 보드 전체 DOM 순서를 저장소 순서로 반영
      const orderedIds = [...board.querySelectorAll(".mea-card")].map((el) => el.dataset.id);
      Storage.reorderMea(orderedIds);

      dragId = null;
      renderMeaList(); // 카운트 갱신
    });
  }

  /* ============================================================
   * MEA 정보 모달 (추가 / 사양 조회·수정 공용)
   * ============================================================ */

  /** 모달이 편집 중인 MEA id. null 이면 "새 MEA 추가" 모드 */
  let modalMeaId = null;

  /**
   * 모달 열기
   * @param {string|null} meaId - null 이면 추가 모드
   */
  function openMeaModal(meaId = null) {
    modalMeaId = meaId;
    const mea = meaId ? Storage.getMea(meaId) : null;

    // 제목/부가정보
    $("meaModalTitle").innerHTML = mea
      ? `<i class="bi bi-info-circle"></i> MEA 정보 - ${mea.name}`
      : `<i class="bi bi-plus-circle"></i> 새 MEA 추가`;
    $("meaModalSub").textContent = mea
      ? `이 MEA로 저장된 실험 ${Storage.state.experiments.filter((e) => e.meaId === mea.id).length}건`
      : "";

    // MEA_SPEC_FIELDS 정의로 폼 자동 생성
    const body = $("meaModalBody");
    const frag = document.createDocumentFragment();
    // 추가 모드일 때 "MEA-00N" 다음 번호 자동 제안
    const suggested = `MEA-${String(Storage.state.meaList.length + 1).padStart(3, "0")}`;

    MEA_SPEC_FIELDS.forEach((field) => {
      // 구분 헤더
      if (field.section) {
        const h = document.createElement("div");
        h.className = "modal-section";
        h.textContent = field.section;
        frag.appendChild(h);
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "meta-field" + (field.full ? " full" : "");
      // name 은 mea.name, 나머지는 mea.specs 에서 읽음
      const value = field.key === "name"
        ? (mea ? mea.name : suggested)
        : (mea?.specs?.[field.key] ?? "");
      wrap.innerHTML = `
        <label>${field.label}</label>
        <input type="${field.type}" step="any" data-spec="${field.key}"
               placeholder="${field.placeholder || ""}" />`;
      wrap.querySelector("input").value = value; // 특수문자 안전하게 주입
      frag.appendChild(wrap);
    });
    body.replaceChildren(frag);

    $("meaModal").hidden = false;
    body.querySelector('input[data-spec="name"]')?.focus();
  }

  function closeMeaModal() {
    $("meaModal").hidden = true;
    modalMeaId = null;
  }

  /** 모달 저장: 추가 모드면 새 MEA 생성, 수정 모드면 이름+사양 갱신 */
  function saveMeaModal() {
    const inputs = $("meaModalBody").querySelectorAll("input[data-spec]");
    const values = {};
    inputs.forEach((input) => { values[input.dataset.spec] = input.value.trim(); });

    const name = values.name;
    if (!name) {
      Utils.toast("MEA 이름을 입력하세요.");
      return;
    }
    delete values.name; // 나머지는 specs 로 저장

    if (modalMeaId) {
      Storage.renameMea(modalMeaId, name);
      Storage.updateMeaSpecs(modalMeaId, values);
      Utils.toast(`${name} 정보를 수정했습니다.`);
    } else {
      const mea = Storage.addMea(name, values);
      Storage.selectMea(mea.id); // 새로 추가한 MEA 를 바로 실험 대상으로
      Utils.toast(`${name} 을(를) 추가했습니다.`);
    }
    closeMeaModal();
    renderMeaList();
    renderConditions();
  }

  /** 모달 이벤트 바인딩 (닫기/저장/오버레이/ESC) */
  function bindMeaModal() {
    $("btnAddMea").addEventListener("click", () => openMeaModal(null));
    $("meaModalClose").addEventListener("click", closeMeaModal);
    $("meaModalCancel").addEventListener("click", closeMeaModal);
    $("meaModalSave").addEventListener("click", saveMeaModal);

    // 오버레이(바깥) 클릭 시 닫기
    $("meaModal").addEventListener("click", (e) => {
      if (e.target === $("meaModal")) closeMeaModal();
    });

    // ESC 로 닫기, 모달 안에서 Enter 로 저장
    document.addEventListener("keydown", (e) => {
      if ($("meaModal").hidden) return;
      if (e.key === "Escape") closeMeaModal();
      if (e.key === "Enter" && e.target.matches("#meaModalBody input")) saveMeaModal();
    });
  }

  /* ============================================================
   * 실험 조건 (선택된 MEA별 저장)
   * ============================================================ */

  /** 조건 입력 UI 를 CONDITION_FIELDS 정의로부터 생성 */
  function renderConditions() {
    const grid = $("condGrid");
    const mea = Storage.getSelectedMea();
    $("condMeaName").textContent = mea ? `- ${mea.name}` : "(MEA를 선택하세요)";
    grid.classList.toggle("cond-disabled", !mea);

    const frag = document.createDocumentFragment();
    CONDITION_FIELDS.forEach((field) => {
      const wrap = document.createElement("div");
      wrap.className = "meta-field" + (field.full ? " full" : "");
      const value = mea?.conditions?.[field.key] ?? "";

      if (field.type === "number-unit") {
        // 숫자 입력 + 단위 선택 (예: Flow Rate mL/min 또는 V)
        const curUnit = mea?.conditions?.[field.unitKey] || field.units[0];
        wrap.innerHTML = `
          <label>${field.label} <small class="unit-tag">${curUnit}</small></label>
          <div class="num-unit">
            <input type="number" step="any" data-cond="${field.key}"
                   placeholder="${field.placeholder || ""}" />
            <select data-cond="${field.unitKey}" title="단위 선택">
              ${field.units.map((u) => `<option value="${u}" ${u === curUnit ? "selected" : ""}>${u}</option>`).join("")}
            </select>
          </div>`;
        wrap.querySelector("input").value = value;
      } else if (field.type === "select") {
        // 선택형 조건 (예: 평가 Cell 수 1/3/5 + 직접 입력)
        const options = [...(field.options || [])];
        // 저장된 값이 프리셋에 없으면 옵션에 동적으로 추가 (예: 2-cell)
        if (value !== "" && !options.includes(Number(value))) options.push(Number(value));
        options.sort((a, b) => a - b);

        const optionHtml =
          `<option value="">선택...</option>` +
          options.map((o) => `<option value="${o}" ${String(o) === String(value) ? "selected" : ""}>${o} cell</option>`).join("") +
          (field.allowCustom ? `<option value="__custom__">직접 입력...</option>` : "");
        wrap.innerHTML = `<label>${field.label}</label><select data-cond="${field.key}">${optionHtml}</select>`;
      } else {
        wrap.innerHTML = `
          <label>${field.label}</label>
          <input type="${field.type}" step="any" data-cond="${field.key}"
                 placeholder="${field.placeholder || ""}" />`;
        wrap.querySelector("input").value = value; // 특수문자 안전 주입
      }
      frag.appendChild(wrap);
    });
    grid.replaceChildren(frag);

    // 자동 계산 미리보기 + 셀별 전압 입력칸 갱신
    updateCalcPreview();
    renderCellVoltageInputs();
  }

  /** 조건 입력 변경 → MEA별 저장 (debounce 로 과도한 저장 방지) */
  const onConditionInput = Utils.debounce((key, value) => {
    Storage.updateConditions({ [key]: value });
    updateCalcPreview();
    // Cell 수가 바뀌면 셀별 입력칸 개수도 갱신
    if (key === "cellCount") renderCellVoltageInputs();
    // 단위가 바뀌면 라벨의 단위 태그 갱신
    if (key.endsWith("Unit")) {
      const mea = Storage.getSelectedMea();
      const field = CONDITION_FIELDS.find((f) => f.unitKey === key);
      if (field) {
        const tag = document.querySelector(`#condGrid [data-cond="${field.key}"]`)
          ?.closest(".meta-field")?.querySelector(".unit-tag");
        if (tag) tag.textContent = mea?.conditions?.[key] || field.units[0];
      }
    }
  }, 250);

  /* ============================================================
   * 4. 측정 데이터 입력
   * ============================================================ */

  /**
   * Cell Voltage 입력칸 렌더링
   * - 평가 Cell 수(N)만큼 입력칸 생성
   * - 왼쪽 = Top(−) → 오른쪽 = Bottom(+)
   * - Cell 수 미설정 시 자동 계산(전압÷N) 표시칸으로 대체
   */
  function renderCellVoltageInputs() {
    const box = $("cellvInputs");
    const hint = $("cellvHint");
    const merge = $("cellvMerge");
    if (!box) return;
    const n = Number(Storage.getSelectedMea()?.conditions?.cellCount) || 0;

    if (n < 1) {
      hint.textContent = "(Cell 수 설정 시 셀별 입력)";
      box.innerHTML = `<input type="text" id="inCellVoltage" readonly title="스택 전압 ÷ 평가 Cell 수 자동 계산" />`;
      if (merge) merge.innerHTML = "";
      updateCalcPreview();
      return;
    }

    hint.textContent = "왼쪽 Top(−) → 오른쪽 Bottom(+)";
    box.innerHTML = Array.from({ length: n }, (_, i) => {
      const tag = n === 1 ? "Cell 1"
        : i === 0 ? `1 · Top(−)`
        : i === n - 1 ? `${n} · Bot(+)`
        : `Cell ${i + 1}`;
      return `<span class="cellv-item">
        <em>${tag}</em>
        <input type="number" step="0.01" class="cellv-in" data-cell="${i}" placeholder="V" />
      </span>`;
    }).join("");
    updateCellvMerge();
  }

  /**
   * 셀 전압 입력값 합류 UI + 자동 합계 갱신
   * - 각 입력에서 선이 나와 한 점으로 모이고, 합계(Σ)와 평균, 전류밀도를 표시
   * - 입력값이 바뀔 때마다 실시간으로 갱신
   */
  function updateCellvMerge() {
    const merge = $("cellvMerge");
    if (!merge) return;
    const inputs = [...document.querySelectorAll(".cellv-in")];
    if (!inputs.length) { merge.innerHTML = ""; return; }

    const vals = inputs.map((inp) => (inp.value === "" ? null : Number(inp.value)));
    const entered = vals.filter((v) => Number.isFinite(v));
    const sum = entered.reduce((a, b) => a + b, 0);
    const avg = entered.length ? sum / entered.length : null;

    // 전류밀도 (참고 표시)
    const specs = Storage.getSelectedMea()?.specs || {};
    const cd = Utils.safeDivide($("inCurrent").value, specs.activeArea);

    // 합류선 SVG: 각 입력 위치에서 중앙 하단 한 점으로 수렴
    const n = inputs.length;
    const W = 100, H = 34; // viewBox 비율 (%로 렌더)
    const mergeX = W / 2, mergeY = H - 4;
    const lines = inputs.map((_, i) => {
      const x = n === 1 ? W / 2 : (W / (n + 1)) * (i + 1);
      const filled = Number.isFinite(vals[i]);
      return `<path d="M ${x} 2 C ${x} ${H / 2}, ${mergeX} ${H / 2}, ${mergeX} ${mergeY}"
        fill="none" stroke="${filled ? "var(--primary)" : "var(--border)"}"
        stroke-width="${filled ? 1.6 : 1}" opacity="${filled ? 1 : 0.5}"/>`;
    }).join("");

    merge.innerHTML = `
      <svg class="cellv-merge-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lines}
        <circle cx="${mergeX}" cy="${mergeY}" r="2.2" fill="var(--primary)"/>
      </svg>
      <div class="cellv-readout">
        <span class="cv-sum"><b>Σ ${entered.length ? sum.toFixed(3) : "—"}</b> V
          <small>(${entered.length}/${n} · 평균 ${avg === null ? "—" : avg.toFixed(3)} V)</small></span>
        <span class="cv-cd">C.D. <b>${cd === null ? "—" : cd.toFixed(3)}</b> A/cm²</span>
      </div>`;
  }

  /**
   * 자동 계산값 미리보기
   * - 전류밀도 = 전류 ÷ Active Area (MEA 사양)
   * - 셀 전압(자동 표시칸이 있을 때만) = 스택 전압 ÷ 평가 Cell 수
   */
  function updateCalcPreview() {
    const mea = Storage.getSelectedMea();
    const specs = mea?.specs || {};
    const cond = mea?.conditions || {};
    const current = $("inCurrent").value;
    const voltage = $("inVoltage").value;

    const cd = Utils.safeDivide(current, specs.activeArea);
    $("inCurrentDensity").value = cd === null ? "" : cd.toFixed(3);

    const cvEl = $("inCellVoltage"); // Cell 수 미설정 시에만 존재
    if (cvEl) {
      const cv = Utils.safeDivide(voltage, cond.cellCount);
      cvEl.value = cv === null ? "" : cv.toFixed(3);
    }
  }

  /** "데이터 추가" - 현재 경과시간 자동 기록 + 자동 계산 */
  function addDataRow() {
    if (app.runState !== "running") {
      Utils.toast("Start 버튼으로 실험을 시작한 뒤 추가할 수 있습니다.");
      return;
    }
    const selMea = Storage.getSelectedMea();
    const specs = selMea?.specs || {};
    const cond = selMea?.conditions || {};
    const temperature = $("inTemperature").value;
    const voltage = $("inVoltage").value;
    const current = $("inCurrent").value;

    // 셀별 전압 입력값 수집 (왼쪽 Top(−) → 오른쪽 Bottom(+) 순서)
    const cellInputs = [...document.querySelectorAll(".cellv-in")];
    const cellVoltages = cellInputs.length
      ? cellInputs.map((inp) => (inp.value === "" ? null : Number(inp.value)))
      : null;
    const enteredCells = (cellVoltages || []).filter((v) => Number.isFinite(v));

    if (voltage === "" && current === "" && temperature === "" && !enteredCells.length) {
      Utils.toast("측정값을 하나 이상 입력하세요.");
      return;
    }

    const sec = elapsedSeconds();
    const row = {
      time: Utils.formatElapsed(sec),      // hh:mm:ss (요구 형식)
      elapsedSec: Math.floor(sec),         // 정렬/분석용 숫자
      temperature: temperature === "" ? null : Number(temperature),
      voltage: voltage === "" ? null : Number(voltage),
      current: current === "" ? null : Number(current),
      // 자동 계산: 전류밀도 = 전류/활성면적(사양)
      currentDensity: Utils.safeDivide(current, specs.activeArea),
      // 셀 전압: 셀별 입력이 있으면 평균, 없으면 스택 전압/Cell 수 자동 계산
      cellVoltage: enteredCells.length
        ? enteredCells.reduce((a, b) => a + b, 0) / enteredCells.length
        : Utils.safeDivide(voltage, cond.cellCount),
      cellVoltages, // 셀별 개별값 [Top(−) ... Bottom(+)]
      // 전체 셀 전압 (AC Clamp meter 측정값)
      totalCellVoltage: $("inTotalCellVoltage").value === "" ? null : Number($("inTotalCellVoltage").value),
    };

    app.rows.push(row);
    syncAfterDataChange();

    // 다음 입력을 쉽게 하도록 셀 전압 입력값 초기화 (합계·합류선도 리셋)
    document.querySelectorAll(".cellv-in").forEach((inp) => { inp.value = ""; });
    $("inTotalCellVoltage").value = "";
    updateCellvMerge();
    // 첫 셀 입력칸으로 포커스 이동 (연속 입력 편의)
    document.querySelector(".cellv-in")?.focus();
  }

  /* ============================================================
   * 측정 데이터 행 편집 모달
   * ============================================================ */

  let rowModalIndex = -1;

  /** 행 편집 모달 열기 */
  function openRowModal(index) {
    const row = app.rows[index];
    if (!row) return;
    rowModalIndex = index;
    $("rowModalTitle").innerHTML = `<i class="bi bi-pencil-square"></i> 측정 데이터 수정 <small>(#${index + 1} · ${row.time})</small>`;

    const F = [];
    F.push(`<div class="meta-field"><label>Temperature (℃)</label>
      <input data-rm="temperature" type="number" step="any" value="${row.temperature ?? ""}" /></div>`);
    F.push(`<div class="meta-field"><label>Voltage (V)</label>
      <input data-rm="voltage" type="number" step="0.1" value="${row.voltage ?? ""}" /></div>`);
    F.push(`<div class="meta-field"><label>Current (A)</label>
      <input data-rm="current" type="number" step="any" value="${row.current ?? ""}" /></div>`);
    F.push(`<div class="meta-field"><label>전체 Cell Voltage (AC Clamp, V)</label>
      <input data-rm="totalCellVoltage" type="number" step="0.01" value="${row.totalCellVoltage ?? ""}" /></div>`);

    // 셀별 전압 (있으면 각각 편집)
    if (Array.isArray(row.cellVoltages) && row.cellVoltages.length) {
      const n = row.cellVoltages.length;
      F.push(`<div class="meta-field full"><label>Cell Voltage (V) — 왼쪽 Top(−) → 오른쪽 Bot(+)</label>
        <div class="cellv-inputs">${row.cellVoltages.map((v, i) => {
          const tag = n === 1 ? "Cell 1" : i === 0 ? "1·Top" : i === n - 1 ? `${n}·Bot` : `${i + 1}`;
          return `<span class="cellv-item"><em>${tag}</em>
            <input data-rmcell="${i}" type="number" step="0.01" value="${v ?? ""}" /></span>`;
        }).join("")}</div></div>`);
    }

    $("rowModalBody").innerHTML = F.join("");
    $("rowModal").hidden = false;
  }

  function closeRowModal() { $("rowModal").hidden = true; rowModalIndex = -1; }

  /** 행 편집 저장 (전류밀도·셀전압 평균 자동 재계산) */
  function saveRowModal() {
    const row = app.rows[rowModalIndex];
    if (!row) { closeRowModal(); return; }
    const specs = Storage.getSelectedMea()?.specs || {};
    const cond = Storage.getSelectedMea()?.conditions || {};

    document.querySelectorAll("#rowModalBody [data-rm]").forEach((el) => {
      const k = el.dataset.rm;
      row[k] = el.value === "" ? null : Number(el.value);
    });
    // 셀별 전압 갱신
    const cellEls = [...document.querySelectorAll("#rowModalBody [data-rmcell]")];
    if (cellEls.length) {
      row.cellVoltages = cellEls.map((el) => (el.value === "" ? null : Number(el.value)));
    }

    // 파생값 재계산
    row.currentDensity = Utils.safeDivide(row.current, specs.activeArea);
    const entered = (row.cellVoltages || []).filter((v) => Number.isFinite(v));
    row.cellVoltage = entered.length
      ? entered.reduce((a, b) => a + b, 0) / entered.length
      : Utils.safeDivide(row.voltage, cond.cellCount);

    closeRowModal();
    syncAfterDataChange();
    Utils.toast(`#${rowModalIndex + 1} 행을 수정했습니다.`);
  }

  function bindRowModal() {
    $("rowModalClose").addEventListener("click", closeRowModal);
    $("rowModalCancel").addEventListener("click", closeRowModal);
    $("rowModalSave").addEventListener("click", saveRowModal);
    $("rowModalDelete").addEventListener("click", () => {
      if (rowModalIndex < 0) return;
      const idx = rowModalIndex;
      closeRowModal();
      app.rows.splice(idx, 1);
      syncAfterDataChange();
      Utils.toast(`#${idx + 1} 행을 삭제했습니다.`);
    });
    $("rowModal").addEventListener("click", (e) => {
      if (e.target === $("rowModal")) closeRowModal();
    });
    document.addEventListener("keydown", (e) => {
      if ($("rowModal").hidden) return;
      if (e.key === "Escape") closeRowModal();
      if (e.key === "Enter" && e.target.matches("#rowModalBody input")) saveRowModal();
    });
  }

  /** 선택 행 삭제 */
  function deleteSelectedRow() {
    // 마지막 측정 행 삭제 (연속 측정 중 오입력 되돌리기용)
    if (!app.rows.length) {
      Utils.toast("삭제할 데이터가 없습니다.");
      return;
    }
    app.rows.pop();
    DataTable.clearSelection();
    syncAfterDataChange();
    Utils.toast("마지막 행을 삭제했습니다.");
  }

  /** 전체 행 삭제 */
  function clearAllRows() {
    if (!app.rows.length) return;
    if (!confirm("측정 데이터를 전체 삭제할까요?")) return;
    app.rows = [];
    DataTable.clearSelection();
    syncAfterDataChange();
  }

  /** 데이터 변경 후 테이블/그래프/draft 백업 동기화 */
  function syncAfterDataChange() {
    DataTable.render(app.rows);
    LiveChart.update(app.rows);
    // 진행 중 데이터를 LocalStorage 에 백업 (브라우저 재시작 대비)
    Storage.saveDraft({
      meaId: Storage.state.selectedMeaId,
      rows: app.rows,
      elapsedSec: Math.floor(elapsedSeconds()),
    });
  }

  /* ============================================================
   * 5. Experiment 저장/목록/불러오기
   * ============================================================ */

  /** "실험 저장" 버튼 - 진행 중에도 수동 저장 가능 */
  function saveExperimentManual() {
    if (!app.rows.length) {
      Utils.toast("저장할 측정 데이터가 없습니다.");
      return;
    }
    const exp = Storage.saveExperiment(app.rows, currentExpType());
    if (!exp) {
      Utils.toast("MEA를 먼저 선택하세요.");
      return;
    }
    renderExpList();
    Utils.toast(`${exp.name} (${exp.meaName}) 저장 완료`);
  }

  /** 저장된 Experiment 목록 렌더링 */
  function renderExpList() {
    const ul = $("expList");
    const exps = Storage.state.experiments;

    if (!exps.length) {
      ul.innerHTML = `<li class="empty-msg">저장된 실험이 없습니다</li>`;
      return;
    }

    const frag = document.createDocumentFragment();
    exps.forEach((exp) => {
      const li = document.createElement("li");
      li.className = "exp-item";
      li.dataset.id = exp.id;
      li.title = "클릭하면 테이블/그래프로 불러옵니다";
      li.innerHTML = `
        <i class="bi bi-file-earmark-bar-graph"></i>
        <span class="exp-info">
          <span class="exp-name">${exp.name}
            <span class="type-badge ${exp.type === "iv" ? "type-iv" : ""}">${exp.type === "iv" ? "IV" : "안정성"}</span>
          </span>
          <span class="exp-sub">${exp.meaName} · ${exp.date} · ${exp.data.length} rows${
            exp.conditions?.cellCount ? ` · ${exp.conditions.cellCount}-cell` : ""
          }</span>
        </span>
        <button class="exp-edit" title="제목 수정"><i class="bi bi-pencil"></i></button>
        <button class="exp-del" title="삭제"><i class="bi bi-trash3"></i></button>`;
      frag.appendChild(li);
    });
    ul.replaceChildren(frag);
  }

  /* ============================================================
   * Experiment 편집 모달
   * ============================================================ */

  let expModalId = null;

  function openExpModal(expId) {
    const exp = Storage.getExperiment(expId);
    if (!exp) return;
    expModalId = expId;
    $("expModalTitle").innerHTML = `<i class="bi bi-pencil-square"></i> Experiment 수정 <small>(${exp.name})</small>`;

    const meaOptions = Storage.state.meaList
      .map((m) => `<option value="${m.id}" ${m.id === exp.meaId ? "selected" : ""}>${m.name}</option>`)
      .join("");

    $("expModalBody").innerHTML = `
      <div class="meta-field full"><label>제목</label>
        <input data-em="name" type="text" value="${(exp.name || "").replace(/"/g, "&quot;")}" /></div>
      <div class="meta-field full"><label>사용된 MEA</label>
        <select data-em="meaId"><option value="">(변경 안 함)</option>${meaOptions}</select></div>
      <div class="meta-field"><label>실험 유형</label>
        <select data-em="type">
          <option value="stability" ${exp.type !== "iv" ? "selected" : ""}>안정성 (시간)</option>
          <option value="iv" ${exp.type === "iv" ? "selected" : ""}>IV 측정 (Polarization)</option>
        </select></div>
      <div class="meta-field"><label>평가 Cell 수</label>
        <input data-em="cellCount" type="number" min="1" step="1" value="${exp.conditions?.cellCount ?? ""}" /></div>
      <div class="meta-field"><label>Temperature (℃)</label>
        <input data-em="temperature" type="number" step="any" value="${exp.conditions?.temperature ?? ""}" /></div>
      <div class="meta-field"><label>날짜</label>
        <input data-em="date" type="date" value="${exp.date || ""}" /></div>
      <div class="meta-field"><label>실험자</label>
        <input data-em="operator" type="text" value="${(exp.operator || "").replace(/"/g, "&quot;")}" /></div>
      <div class="meta-field full"><label>메모</label>
        <input data-em="memo" type="text" value="${(exp.memo || "").replace(/"/g, "&quot;")}" /></div>`;
    $("expModal").hidden = false;
  }

  function closeExpModal() { $("expModal").hidden = true; expModalId = null; }

  function saveExpModal() {
    const exp = Storage.getExperiment(expModalId);
    if (!exp) { closeExpModal(); return; }
    const get = (k) => document.querySelector(`#expModalBody [data-em="${k}"]`)?.value;

    const patch = {};
    const name = (get("name") || "").trim();
    if (name) patch.name = name;
    patch.type = get("type") === "iv" ? "iv" : "stability";
    patch.date = get("date") || exp.date;
    patch.operator = get("operator") || "";
    patch.memo = get("memo") || "";
    const meaId = get("meaId");
    if (meaId) patch.meaId = meaId;

    const condPatch = {};
    const cc = get("cellCount");
    condPatch.cellCount = cc === "" ? null : Number(cc);
    const tp = get("temperature");
    condPatch.temperature = tp === "" ? null : Number(tp);

    Storage.updateExperiment(expModalId, patch, condPatch);
    closeExpModal();
    renderExpList();
    Utils.toast("Experiment 정보를 수정했습니다.");
  }

  function bindExpModal() {
    $("expModalClose").addEventListener("click", closeExpModal);
    $("expModalCancel").addEventListener("click", closeExpModal);
    $("expModalSave").addEventListener("click", saveExpModal);
    $("expModal").addEventListener("click", (e) => {
      if (e.target === $("expModal")) closeExpModal();
    });
    document.addEventListener("keydown", (e) => {
      if ($("expModal").hidden) return;
      if (e.key === "Escape") closeExpModal();
      if (e.key === "Enter" && e.target.matches("#expModalBody input")) saveExpModal();
    });
  }

  /** Experiment 목록 이벤트 (불러오기 / 삭제) */
  function bindExpListEvents() {
    bindExpModal();
    $("expList").addEventListener("click", (e) => {
      const li = e.target.closest(".exp-item");
      if (!li) return;
      const exp = Storage.getExperiment(li.dataset.id);
      if (!exp) return;

      // 편집 (제목·MEA·유형·Cell수·온도·날짜 등)
      if (e.target.closest(".exp-edit")) {
        openExpModal(exp.id);
        return;
      }

      // 삭제
      if (e.target.closest(".exp-del")) {
        if (confirm(`'${exp.name}' 을(를) 삭제할까요?`)) {
          Storage.removeExperiment(exp.id);
          renderExpList();
        }
        return;
      }

      // 불러오기: 진행 중 실험이 있으면 확인
      if (app.runState === "running" || app.runState === "paused") {
        if (!confirm("진행 중인 실험 데이터를 덮어쓰고 불러올까요?")) return;
        clearInterval(app.timerId);
        app.runState = "idle";
        applyRunState();
      }
      app.rows = Utils.deepClone(exp.data);
      if (exp.meaId && Storage.getMea(exp.meaId)) {
        Storage.selectMea(exp.meaId);
        renderMeaList();
        renderConditions();
      }
      DataTable.render(app.rows);
      LiveChart.update(app.rows);
      Utils.toast(`${exp.name} 을(를) 불러왔습니다.`);
    });
  }

  /* ============================================================
   * 내보내기 대상 선택 모달 (CSV / Excel 공용)
   * ============================================================ */

  let exportFormat = "csv"; // 현재 열린 모달의 형식

  /** 내보내기 실행 래퍼: 예외 발생 시 토스트로 원인 표시 (조용한 실패 방지) */
  function runExport(label, fn) {
    try { fn(); }
    catch (err) {
      console.error(`[Export] ${label} 실패:`, err);
      Utils.toast(`⚠ ${label} 실패: ${err.message}`, 4500);
    }
  }

  /** 내보내기 가능한 데이터셋 목록 (현재 측정 + 저장된 Experiment) */
  function exportableDatasets() {
    const items = [];
    // 현재 진행/입력 중인 측정 데이터 (저장 전이라도 내보내기 가능)
    if (app.rows.length) {
      const meaName = Storage.getSelectedMea()?.name || "현재 측정";
      items.push({
        id: "__current__",
        name: `현재 측정 데이터 (${meaName})`,
        sub: `${app.rows.length} rows · 저장 전`,
        data: app.rows,
        meaName,
        conditions: Storage.getSelectedMea()?.conditions || {},
        specs: Storage.getSelectedMea()?.specs || {},
        type: currentExpType(),
        date: Storage.state.meta.date,
        current: true,
      });
    }
    // 저장된 Experiment
    Storage.state.experiments.forEach((exp) => {
      items.push({
        id: exp.id,
        name: exp.name,
        sub: `${exp.meaName} · ${exp.date} · ${exp.data.length} rows${exp.type === "iv" ? " · IV" : ""}`,
        data: exp.data,
        exp,
      });
    });
    return items;
  }

  /** 모달 열기 */
  function openExportModal(format) {
    exportFormat = format;
    const datasets = exportableDatasets();

    if (!datasets.length) {
      Utils.toast("내보낼 데이터가 없습니다. 측정 후 다시 시도하세요.");
      return;
    }

    $("exportModalTitle").innerHTML = format === "xlsx"
      ? `<i class="bi bi-file-earmark-excel"></i> Excel 내보내기 대상 선택`
      : `<i class="bi bi-filetype-csv"></i> CSV 내보내기 대상 선택`;
    $("exportModalDesc").textContent = format === "xlsx"
      ? "선택한 실험이 각각 별도 시트로 저장됩니다."
      : "선택한 실험이 하나의 CSV로 합쳐집니다 (여러 개 선택 시 Experiment 열 추가).";

    // 목록 렌더링 (기본: 전체 체크)
    $("exportList").innerHTML = datasets.map((d) => `
      <li>
        <label class="export-item">
          <input type="checkbox" data-exp="${d.id}" checked />
          <span class="export-item-info">
            <span class="export-item-name">${d.name}</span>
            <span class="export-item-sub">${d.sub}</span>
          </span>
        </label>
      </li>`).join("");

    $("exportSelectAll").checked = true;
    updateExportHint();
    $("exportModal").hidden = false;
  }

  function closeExportModal() { $("exportModal").hidden = true; }

  function updateExportHint() {
    const n = document.querySelectorAll("#exportList input[data-exp]:checked").length;
    $("exportModalHint").textContent = `${n}개 선택됨`;
    $("exportModalGo").disabled = n === 0;
  }

  /** 선택 실행 */
  function runExportModal() {
    const datasets = exportableDatasets();
    const checkedIds = new Set(
      [...document.querySelectorAll("#exportList input[data-exp]:checked")].map((i) => i.dataset.exp)
    );
    const selected = datasets.filter((d) => checkedIds.has(d.id));
    if (!selected.length) return;

    runExport(exportFormat === "xlsx" ? "Excel 내보내기" : "CSV 내보내기", () => {
      if (exportFormat === "csv") {
        Exporter.saveCSV(selected.map((d) => ({ name: d.name, data: d.data })));
      } else {
        // Excel: Experiment 형태로 변환 (현재 측정도 임시 Experiment 로)
        const exps = selected.map((d) => d.exp || {
          name: d.name, type: d.type, meaName: d.meaName, date: d.date,
          operator: Storage.state.meta.operator, memo: Storage.state.meta.memo,
          conditions: d.conditions, specs: d.specs, data: d.data,
        });
        Exporter.saveXLSX(exps);
      }
    });
    closeExportModal();
  }

  function bindExportModal() {
    $("exportModalClose").addEventListener("click", closeExportModal);
    $("exportModalCancel").addEventListener("click", closeExportModal);
    $("exportModalGo").addEventListener("click", runExportModal);
    $("exportModal").addEventListener("click", (e) => {
      if (e.target === $("exportModal")) closeExportModal();
    });
    // 전체 선택 토글
    $("exportSelectAll").addEventListener("change", (e) => {
      document.querySelectorAll("#exportList input[data-exp]").forEach((i) => { i.checked = e.target.checked; });
      updateExportHint();
    });
    // 개별 체크 변경
    $("exportList").addEventListener("change", updateExportHint);
    document.addEventListener("keydown", (e) => {
      if (!$("exportModal").hidden && e.key === "Escape") closeExportModal();
    });
  }

  /* ============================================================
   * 6. 내보내기 버튼
   * ============================================================ */
  function bindExportButtons() {
    // 저장 드롭다운: hover 는 CSS 로, 클릭 토글은 터치 환경 대비
    const dropdown = document.querySelector(".topbar .dropdown");
    $("btnSaveMenu").addEventListener("click", () => dropdown.classList.toggle("open"));
    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target)) dropdown.classList.remove("open");
    });
    // 메뉴 항목 선택 후 자동 닫기
    dropdown.querySelectorAll(".dropdown-item").forEach((btn) =>
      btn.addEventListener("click", () => dropdown.classList.remove("open"))
    );

    $("btnJsonSave").addEventListener("click", () => runExport("JSON 저장", () => Exporter.saveJSON()));
    const pub = $("btnPublishSave");
    if (pub) pub.addEventListener("click", () => runExport("배포용 저장", () => Exporter.savePublishJSON()));

    $("btnJsonLoad").addEventListener("click", () => $("fileJson").click());
    $("fileJson").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      Exporter.loadJSON(file, () => {
        // 복원 후 전체 UI 다시 그리기
        app.rows = [];
        renderAll();
      });
      e.target.value = ""; // 같은 파일 재선택 허용
    });

    // Excel 가져오기: 내보낸 xlsx 를 다시 Experiment 로 추가 (JSON 복원과 달리 덮어쓰지 않음)
    $("btnXlsxLoad").addEventListener("click", () => $("fileXlsx").click());
    $("fileXlsx").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // 같은 파일 재선택 허용
      if (!file) return;
      try {
        const { experiments, warnings } = await Exporter.parseXLSX(file);
        if (!experiments.length) {
          Utils.toast("⚠ 불러올 실험을 찾지 못했습니다. " + (warnings[0] || ""), 4500);
          return;
        }
        const list = experiments
          .map((x) => `· ${x.name} (${x.data.length}행${x.meaName ? ", " + x.meaName : ""})`)
          .join("\n");
        if (!confirm(`실험 ${experiments.length}건을 목록에 추가합니다.\n\n${list}\n\n기존 데이터는 그대로 유지됩니다. 진행할까요?`)) return;

        const { added, skipped, createdMeas } = Storage.importExperiments(experiments);
        renderAll();
        const parts = [`실험 ${added.length}건을 추가했습니다.`];
        if (createdMeas.length) parts.push(`MEA ${createdMeas.length}개 신규 등록`);
        if (skipped.length) parts.push(`중복 ${skipped.length}건 건너뜀`);
        if (warnings.length) parts.push(`시트 ${warnings.length}개 해석 실패`);
        Utils.toast(parts.join(" · "), 4500);
      } catch (err) {
        Utils.toast("⚠ Excel 가져오기 실패: " + err.message, 4500);
      }
    });

    // CSV / Excel: 대상 선택 모달을 연다
    $("btnCsv").addEventListener("click", () => openExportModal("csv"));
    $("btnXlsx").addEventListener("click", () => openExportModal("xlsx"));
    $("btnPng").addEventListener("click", () => runExport("PNG 저장", () => Exporter.savePNG()));

    bindExportModal();
  }

  /* ============================================================
   * 7. 페이지 전환 / 테마 / 시계 / 헤더 메타
   * ============================================================ */

  /** 사이드바 페이지 전환 */
  function bindNavigation() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $(btn.dataset.page).classList.add("active");
        // 다른 모듈(analysis.js 등)이 페이지 진입 시점을 알 수 있도록 알림
        document.dispatchEvent(new CustomEvent("page:changed", { detail: { page: btn.dataset.page } }));
      });
    });
  }

  /** 테마 적용 + 토글 버튼 라벨 갱신 */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = $("themeToggle");
    btn.innerHTML = theme === "dark"
      ? `<i class="bi bi-sun"></i><span>Light Mode</span>`
      : `<i class="bi bi-moon-stars"></i><span>Dark Mode</span>`;
    LiveChart.applyTheme(); // 그래프 축 색상도 함께 전환
    // 단면도는 CSS 변수에서 색을 읽어 그리므로 테마가 바뀌면 다시 그려야 한다
    if (window.LayerDesign && LayerDesign.design) {
      try { LayerDesign.renderSVG(); } catch (err) { console.error("[Theme] 단면도 갱신 실패:", err); }
    }
  }

  function bindTheme() {
    $("themeToggle").addEventListener("click", () => {
      const next = Storage.state.settings.theme === "dark" ? "light" : "dark";
      Storage.state.settings.theme = next;
      Storage.save();
      applyTheme(next);
    });
  }

  /** 헤더의 날짜/실험자/메모 입력을 상태와 동기화 */
  function bindHeaderMeta() {
    $("metaDate").value = Storage.state.meta.date || Utils.todayString();
    $("metaOperator").value = Storage.state.meta.operator || "";
    $("metaMemo").value = Storage.state.meta.memo || "";

    const sync = Utils.debounce(() => {
      Storage.state.meta = {
        date: $("metaDate").value,
        operator: $("metaOperator").value,
        memo: $("metaMemo").value,
      };
      Storage.save();
    }, 300);

    ["metaDate", "metaOperator", "metaMemo"].forEach((id) =>
      $(id).addEventListener("input", sync)
    );

    // 실시간 시계 (1초 주기)
    const clock = () => { $("metaClock").value = Utils.nowClock(); };
    clock();
    setInterval(clock, 1000);
  }

  /* ============================================================
   * draft 복구 - 브라우저를 껐다 켜도 진행 중 데이터 유지
   * ============================================================ */
  function restoreDraft() {
    const draft = Storage.state.draft;
    if (!draft || !draft.rows?.length) return;
    if (!confirm(`저장하지 않은 측정 데이터 ${draft.rows.length}행이 있습니다. 복구할까요?`)) {
      Storage.clearDraft();
      return;
    }
    app.rows = draft.rows;
    // 타이머는 마지막 경과시간에서 일시정지 상태로 복구
    app.accumulated = (draft.elapsedSec || 0) * 1000;
    app.runState = "paused";
    if (draft.meaId && Storage.getMea(draft.meaId)) Storage.selectMea(draft.meaId);
    tick();
    Utils.toast("이전 측정 데이터를 복구했습니다. Resume으로 이어서 진행하세요.");
  }

  /* ============================================================
   * 전체 렌더링 & 초기화
   * ============================================================ */

  /** 상태 기반으로 화면 전체 다시 그리기 (JSON 복원 후 등) */
  function renderAll() {
    renderMeaList();
    renderConditions();
    renderExpList();
    DataTable.render(app.rows);
    LiveChart.update(app.rows);
    applyTheme(Storage.state.settings.theme);
    $("metaDate").value = Storage.state.meta.date || Utils.todayString();
    $("metaOperator").value = Storage.state.meta.operator || "";
    $("metaMemo").value = Storage.state.meta.memo || "";
    applyRunState();
  }

  /**
   * 초기화 단계 안전 실행 래퍼
   * - 한 단계(예: 그래프 생성)가 실패해도 나머지 UI 는
   *   정상 동작하도록 각 단계를 격리한다.
   */
  function safe(label, fn) {
    try {
      fn();
    } catch (err) {
      console.error(`[init] ${label} 단계 실패:`, err);
      Utils.toast(`⚠ 초기화 경고: ${label} (콘솔 확인)`, 4000);
    }
  }

  /**
   * 필수 라이브러리 로드 확인
   * libs/ 폴더가 누락된 채 복사되면 그래프(Chart.js)와
   * Excel(SheetJS)만 조용히 실패한다 → 화면에 명확히 알려준다.
   */
  function checkLibraries() {
    const missing = [];
    if (typeof Chart === "undefined") missing.push("libs/chart.umd.min.js — 그래프 표시");
    if (typeof XLSX === "undefined") missing.push("libs/xlsx.full.min.js — Excel 내보내기");
    if (!missing.length) return;

    const banner = document.createElement("div");
    banner.className = "lib-error-banner";
    banner.innerHTML = `
      <b>⚠ 필수 라이브러리를 불러오지 못했습니다</b>
      <ul>${missing.map((m) => `<li>${m}</li>`).join("")}</ul>
      <p>대시보드 폴더를 옮기거나 복사할 때는 <b>libs 폴더를 포함한 폴더 전체</b>를
         복사해야 합니다. index.html 과 같은 위치에 libs 폴더가 있는지 확인하세요.</p>
      <button onclick="this.parentElement.remove()">닫기</button>`;
    document.body.prepend(banner);

    // 그래프 영역에도 안내 표시
    if (typeof Chart === "undefined") {
      const wrap = document.querySelector(".chart-wrap");
      if (wrap) wrap.innerHTML = `<div class="empty-msg" style="padding:60px 20px">
        그래프 라이브러리(libs/chart.umd.min.js)를 찾을 수 없습니다.<br/>
        libs 폴더가 index.html 옆에 있는지 확인하세요.</div>`;
    }
  }

  /** 앱 시작점 */
  function init() {
    safe("라이브러리 확인", checkLibraries);
    safe("데이터 로드", () => Storage.load());

    // ---- 1) 이벤트 바인딩 (그래프보다 먼저 - 클릭 무반응 방지) ----
    safe("테이블 초기화", () => DataTable.init());
    safe("페이지 전환", bindNavigation);
    safe("테마", bindTheme);
    safe("헤더 메타", bindHeaderMeta);
    safe("MEA 목록", bindMeaListEvents);
    safe("MEA 모달", bindMeaModal);
    safe("Experiment 목록", bindExpListEvents);
    safe("내보내기", bindExportButtons);

    safe("실험 제어 버튼", () => {
      $("btnStart").addEventListener("click", startExperiment);
      $("btnPause").addEventListener("click", pauseExperiment);
      $("btnResume").addEventListener("click", resumeExperiment);
      $("btnStop").addEventListener("click", stopExperiment);
      $("btnAddRow").addEventListener("click", addDataRow);
      $("btnDeleteRow").addEventListener("click", deleteSelectedRow);
      $("btnClearRows").addEventListener("click", clearAllRows);
      $("btnSaveExp").addEventListener("click", saveExperimentManual);

      // 조건 입력 변경 감지 (위임, input/select 공용)
      $("condGrid").addEventListener("input", (e) => {
        const el = e.target.closest("[data-cond]");
        if (!el) return;

        // "직접 입력..." 선택 시 → 숫자 입력창으로 전환
        if (el.tagName === "SELECT" && el.value === "__custom__") {
          const key = el.dataset.cond;
          const input = document.createElement("input");
          input.type = "number";
          input.step = "any";
          input.min = "1";
          input.dataset.cond = key;
          input.placeholder = "Cell 수 입력 후 Enter";
          el.replaceWith(input);
          input.focus();
          input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); });
          input.addEventListener("blur", () => {
            if (input.value) Storage.updateConditions({ [key]: Number(input.value) });
            renderConditions(); // select 형태로 복귀 (입력값은 옵션에 추가됨)
          }, { once: true });
          return;
        }

        onConditionInput(el.dataset.cond, el.value);
      });

      // 측정값 입력 시 자동 계산 미리보기
      ["inVoltage", "inCurrent"].forEach((id) =>
        $(id).addEventListener("input", updateCalcPreview)
      );

      // Enter 키로 빠른 데이터 추가 (측정값 입력 필드에서)
      ["inTemperature", "inVoltage", "inCurrent"].forEach((id) =>
        $(id).addEventListener("keydown", (e) => {
          if (e.key === "Enter") addDataRow();
        })
      );
      // 셀별 전압 입력칸도 Enter 지원 (동적 생성이므로 위임)
      $("cellvInputs").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches(".cellv-in")) addDataRow();
      });
      // 셀 전압 입력 시 합계(Σ)/합류선 실시간 갱신
      $("cellvInputs").addEventListener("input", (e) => {
        if (e.target.matches(".cellv-in")) updateCellvMerge();
      });
      // 전류 변경 시 합류 readout 의 전류밀도도 갱신
      $("inCurrent").addEventListener("input", updateCellvMerge);

      // 테이블 행 개별 삭제 (table.js 의 커스텀 이벤트)
      document.addEventListener("table:deleteRow", (e) => {
        app.rows.splice(e.detail.index, 1);
        DataTable.clearSelection();
        syncAfterDataChange();
      });

      // 테이블 행 클릭 → 편집 모달
      document.addEventListener("table:editRow", (e) => openRowModal(e.detail.index));
      bindRowModal();
    });

    // ---- 2) 그래프 초기화 (실패해도 나머지 기능은 유지) ----
    safe("그래프 초기화", () =>
      LiveChart.init(
        Storage.state.settings.visibleSeries,
        (key, checked) => {
          // 체크 상태를 설정으로 저장 → 다음 실행 시 유지
          Storage.state.settings.visibleSeries[key] = checked;
          Storage.save();
        },
        Storage.state.settings.ivAxes, // IV Curve 축 설정 복원
        (x, y) => {
          Storage.state.settings.ivAxes = { x, y };
          Storage.save();
        }
      )
    );

    // IV Curve PNG 저장
    safe("IV PNG 버튼", () =>
      $("btnIvPng").addEventListener("click", async () => {
        try {
          const blob = await LiveChart.ivToPngBlob();
          if (!blob) { Utils.toast("⚠ IV 그래프가 없습니다."); return; }
          Utils.downloadBlob(blob, `IV_Curve_${Utils.fileTimestamp()}.png`);
          Utils.toast("IV Curve 를 PNG로 저장했습니다.");
        } catch (err) {
          Utils.toast("⚠ PNG 저장 실패: " + err.message, 4000);
        }
      })
    );

    // ---- 3) 초기 렌더링 + draft 복구 ----
    safe("초기 렌더링", renderAll);
    safe("데이터 복구", restoreDraft);
    safe("상태 표시", applyRunState);

    // ---- 4) 배포 data.json 자동 로드 (github.io 방문자용) ----
    tryLoadPublished();
  }

  /**
   * 같은 폴더의 data.json(배포 스냅샷)을 시도해서 불러온다.
   * - 첫 방문(LocalStorage 비어있음): 자동 로드
   * - 재방문인데 data.json 이 더 최신(publishedAt): 덮어쓸지 확인
   * - 이미 최신이거나 파일 없음(file:// 등): 조용히 무시 → 기존 LocalStorage 사용
   */
  async function tryLoadPublished() {
    try {
      const res = await fetch("data.json", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !Array.isArray(json.meaList)) return;

      const published = Number(json.publishedAt) || 0;
      const lastLoaded = Number(Storage.state.settings.lastPublishedAt) || 0;
      const isFresh = !Storage.hadSavedState;         // 첫 방문
      const isNewer = published > 0 && published > lastLoaded;

      if (!isFresh && !isNewer) return;               // 이미 최신 → 그대로 둠
      // 재방문 + 더 최신 배포본이면 덮어쓸지 확인 (첫 방문은 바로 로드)
      if (!isFresh && isNewer) {
        const when = new Date(published).toLocaleString();
        if (!confirm(`새 배포 데이터(${when})가 있습니다.\n현재 화면 데이터를 덮어쓰고 불러올까요?`)) {
          // 거절 시 이 버전은 다시 안 묻도록 기록
          Storage.state.settings.lastPublishedAt = published;
          Storage.save();
          return;
        }
      }

      Storage.importJSON(JSON.stringify(json));
      Storage.state.settings.lastPublishedAt = published;
      Storage.save();
      renderAll();
      Utils.toast("배포 데이터를 불러왔습니다.");
    } catch (err) {
      // data.json 없음 / file:// CORS 등 → 무시하고 LocalStorage 사용
      console.debug("[publish] data.json 자동 로드 건너뜀:", err.message);
    }
  }

  // DOM 준비 후 시작
  document.addEventListener("DOMContentLoaded", init);
})();
