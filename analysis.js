/* ============================================================
 * analysis.js - 데이터 분석 페이지 모듈
 *
 * 저장된 Experiment 를 "평가 Cell 수" 기준으로 필터링하고,
 * 여러 실험을 하나의 그래프에 겹쳐 비교한다.
 *
 * - Cell 수 필터 : 저장된 실험들의 cellCount 로부터 자동 생성
 * - 비교 대상    : 체크박스로 다중 선택
 * - X/Y축       : 드롭다운으로 자유 선택
 *                 (Time, Temperature, Voltage, Current,
 *                  Current Density, Cell Voltage)
 *
 * app.js 가 발행하는 "page:changed" 이벤트로 페이지 진입 시
 * 목록/그래프를 갱신한다. (숨겨진 상태에서 차트를 만들면
 * 크기 계산이 잘못되므로 첫 진입 시점에 생성)
 * ============================================================ */
(function () {
  "use strict";

  /** X/Y축 선택 항목 정의 (확장 지점: 새 측정 변수 추가 시 여기에 등록) */
  const AXIS_OPTIONS = [
    { key: "time",           label: "Time",                    unit: "hh:mm:ss" },
    { key: "temperature",    label: "Temperature",             unit: "℃" },
    { key: "voltage",        label: "Voltage",                 unit: "V" },
    { key: "current",        label: "Current",                 unit: "A" },
    { key: "currentDensity", label: "Current Density",         unit: "A/cm²" },
    { key: "cellVoltage",    label: "Cell Voltage",            unit: "V" },
  ];

  /** 실험별 선 색상 팔레트 (순환 사용) */
  const PALETTE = [
    "#1e6ed4", "#d64550", "#1f9d61", "#d99114", "#7c4fd0",
    "#2b8fb8", "#c2477f", "#5a7d2a", "#8a6d3b", "#4a5568",
  ];

  const Analysis = {

    chart: null,          // 비교용 Chart.js 인스턴스
    cellFilter: "all",    // 현재 Cell 수 필터 ("all" | 숫자 | "none")
    selectedIds: new Set(), // 비교 선택된 Experiment id 집합
    mode: "free",         // 그래프 모드: "free"(자유 비교) | "polar"(Polarization)
    _initialized: false,

    /** 페이지 첫 진입 시 1회 초기화 */
    init() {
      if (this._initialized) return;
      this._initialized = true;

      this._buildAxisSelects();
      this._buildChart();

      // 그래프 모드 탭 (자유 비교 / Polarization)
      document.querySelectorAll(".chart-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          this.mode = tab.dataset.mode;
          document.querySelectorAll(".chart-tab").forEach((t) =>
            t.classList.toggle("active", t === tab));
          // Polarization 모드에선 축이 고정이므로 선택 UI 숨김
          document.getElementById("axisRow").hidden = this.mode === "polar";
          document.getElementById("polarHint").hidden = this.mode !== "polar";
          this.renderExpList(); // IV 아닌 항목 비활성 표시 갱신
          this.updateChart();
        });
      });

      // Cell 필터 칩 클릭 (위임)
      document.getElementById("cellFilter").addEventListener("click", (e) => {
        const chip = e.target.closest(".cell-chip");
        if (!chip) return;
        this.cellFilter = chip.dataset.cell;
        this.renderFilter();
        this.renderExpList();
        this.updateChart();
      });

      // Experiment 체크박스 (위임)
      document.getElementById("cmpExpList").addEventListener("change", (e) => {
        const input = e.target.closest("input[data-exp]");
        if (!input) return;
        if (input.checked) this.selectedIds.add(input.dataset.exp);
        else this.selectedIds.delete(input.dataset.exp);
        this.updateChart();
      });

      // 비교 목록 Drag & Drop 순서 변경 (칸반식, 그래프 겹침/범례 순서 반영)
      this._bindListDrag();

      // 비교 그래프 PNG 저장
      const png = document.getElementById("btnCmpPng");
      if (png) png.addEventListener("click", () => this.exportPNG());
    },

    /** 비교 Experiment 목록 드래그 정렬 (Storage 순서를 직접 재배치) */
    _bindListDrag() {
      const ul = document.getElementById("cmpExpList");
      let dragging = null;

      ul.addEventListener("dragstart", (e) => {
        dragging = e.target.closest("li[data-exp-id]");
        if (dragging) dragging.classList.add("dragging");
      });

      ul.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragging) return;
        // 최근접 위치 계산 (칸반과 동일 알고리즘 - 깜빡임 방지)
        const items = [...ul.querySelectorAll("li[data-exp-id]:not(.dragging)")];
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
        // 현재 DOM 순서를 Storage.experiments 순서에 반영
        const domOrder = [...ul.querySelectorAll("li[data-exp-id]")].map((el) => el.dataset.expId);
        const map = new Map(Storage.state.experiments.map((e) => [e.id, e]));
        // 필터로 보이지 않는 실험은 원래 상대순서를 유지하며 뒤에 배치
        const shown = domOrder.map((id) => map.get(id)).filter(Boolean);
        const hidden = Storage.state.experiments.filter((e) => !domOrder.includes(e.id));
        Storage.state.experiments = [...shown, ...hidden];
        Storage.save();
        this.updateChart(); // 범례/겹침 순서 즉시 반영
      });
    },

    /** 페이지 진입 시마다 목록 갱신 (새로 저장된 실험 반영) */
    refresh() {
      this.init();
      // 삭제된 실험은 선택 목록에서 제거
      const validIds = new Set(Storage.state.experiments.map((e) => e.id));
      this.selectedIds.forEach((id) => { if (!validIds.has(id)) this.selectedIds.delete(id); });

      this.renderFilter();
      this.renderExpList();
      this.updateChart();
      // 숨김 → 표시 전환 직후 차트 크기 재계산
      if (this.chart) this.chart.resize();
    },

    /* ---------------- 필터 / 목록 ---------------- */

    /** Experiment 의 cellCount 값 (없으면 null) */
    _cellOf(exp) {
      const v = Number(exp.conditions?.cellCount);
      return Number.isFinite(v) && v > 0 ? v : null;
    },

    /** Cell 수 필터 칩 렌더링 - 저장된 실험에서 자동 수집 */
    renderFilter() {
      const box = document.getElementById("cellFilter");
      const exps = Storage.state.experiments;

      // 존재하는 Cell 수 집합 (오름차순)
      const cells = [...new Set(exps.map((e) => this._cellOf(e)).filter((v) => v !== null))]
        .sort((a, b) => a - b);
      const hasNone = exps.some((e) => this._cellOf(e) === null);

      const chips = [
        { value: "all", label: `전체 (${exps.length})` },
        ...cells.map((c) => ({
          value: String(c),
          label: `${c}-cell (${exps.filter((e) => this._cellOf(e) === c).length})`,
        })),
        ...(hasNone ? [{ value: "none", label: "미지정" }] : []),
      ];

      box.innerHTML = chips
        .map((c) => `<button class="cell-chip ${String(this.cellFilter) === c.value ? "active" : ""}"
                       data-cell="${c.value}">${c.label}</button>`)
        .join("");
    },

    /** 필터를 통과한 Experiment 목록 */
    _filteredExps() {
      const exps = Storage.state.experiments;
      if (this.cellFilter === "all") return exps;
      if (this.cellFilter === "none") return exps.filter((e) => this._cellOf(e) === null);
      return exps.filter((e) => this._cellOf(e) === Number(this.cellFilter));
    },

    /** 비교 대상 체크 목록 렌더링 */
    renderExpList() {
      const ul = document.getElementById("cmpExpList");
      const exps = this._filteredExps();

      if (!exps.length) {
        ul.innerHTML = `<li class="empty-msg">해당하는 실험이 없습니다.<br/>성능평가 페이지에서 실험을 저장하세요.</li>`;
        return;
      }

      ul.innerHTML = exps
        .map((exp) => {
          const cell = this._cellOf(exp);
          const isIv = exp.type === "iv";
          // Polarization 모드에서 IV 가 아닌 실험은 비활성 표시
          const dimmed = this.mode === "polar" && !isIv;
          return `
          <li data-exp-id="${exp.id}" draggable="true">
            <label class="cmp-exp-item ${dimmed ? "dimmed" : ""}">
              <i class="bi bi-grip-vertical cmp-grip" title="드래그로 순서 변경"></i>
              <input type="checkbox" data-exp="${exp.id}" ${this.selectedIds.has(exp.id) ? "checked" : ""}/>
              <span class="cmp-info">
                <span class="cmp-name">${exp.name}
                  <span class="type-badge ${isIv ? "type-iv" : ""}">${isIv ? "IV" : "안정성"}</span>
                </span>
                <span class="cmp-sub">${exp.meaName} · ${exp.date} · ${exp.data.length} rows</span>
              </span>
              <span class="cell-badge">${cell ? `${cell}-cell` : "미지정"}</span>
            </label>
          </li>`;
        })
        .join("");
    },

    /* ---------------- 그래프 ---------------- */

    /** X/Y축 드롭다운 생성 */
    _buildAxisSelects() {
      const xSel = document.getElementById("cmpAxisX");
      const ySel = document.getElementById("cmpAxisY");
      const optionsHtml = AXIS_OPTIONS
        .map((o) => `<option value="${o.key}">${o.label} (${o.unit})</option>`)
        .join("");
      xSel.innerHTML = optionsHtml;
      ySel.innerHTML = optionsHtml;
      xSel.value = "time";        // 기본: 시간-셀전압 (안정성 비교)
      ySel.value = "cellVoltage";

      [xSel, ySel].forEach((sel) => sel.addEventListener("change", () => this.updateChart()));
    },

    /** 현재 모드 기준 X축 키 (폴라리제이션은 전류밀도 고정) */
    _xKey() {
      return this.mode === "polar" ? "currentDensity" : document.getElementById("cmpAxisX").value;
    },

    /** 비교용 Chart.js 인스턴스 생성 (선+점, 선형 축) */
    _buildChart() {
      const self = this;
      const ctx = document.getElementById("cmpChart").getContext("2d");
      const css = getComputedStyle(document.documentElement);

      this.chart = new Chart(ctx, {
        type: "line",
        data: { datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          parsing: false, // {x, y} 포인트 직접 공급 (성능)
          interaction: { mode: "nearest", intersect: false },
          plugins: {
            legend: { position: "top", labels: { boxWidth: 14, usePointStyle: true } },
            tooltip: {
              callbacks: {
                // X축이 시간이면 hh:mm:ss 로 표시
                title: (items) => {
                  const x = items[0]?.parsed?.x;
                  return self._xKey() === "time" ? Utils.formatElapsed(x) : String(x);
                },
              },
            },
          },
          scales: {
            x: {
              type: "linear",
              title: { display: true, text: "" },
              ticks: {
                color: css.getPropertyValue("--text-sub").trim(),
                // 시간 축이면 초 → hh:mm:ss 변환
                callback: (value) =>
                  self._xKey() === "time" ? Utils.formatElapsed(value) : value,
              },
              grid: { color: css.getPropertyValue("--border").trim() },
            },
            y: {
              title: { display: true, text: "" },
              ticks: { color: css.getPropertyValue("--text-sub").trim() },
              grid: { color: css.getPropertyValue("--border").trim() },
            },
          },
        },
      });
    },

    /** 선택된 Experiment 들로 그래프 갱신 */
    updateChart() {
      if (!this.chart) return;

      // Polarization 모드: X=전류밀도, Y=셀전압 고정
      const xKey = this.mode === "polar" ? "currentDensity" : document.getElementById("cmpAxisX").value;
      const yKey = this.mode === "polar" ? "cellVoltage" : document.getElementById("cmpAxisY").value;
      const xDef = AXIS_OPTIONS.find((o) => o.key === xKey);
      const yDef = AXIS_OPTIONS.find((o) => o.key === yKey);

      // 행 데이터에서 축 값 추출 (time 은 elapsedSec 숫자 사용)
      const valueOf = (row, key) => {
        if (key === "time") {
          const v = Number(row.elapsedSec);
          return Number.isFinite(v) ? v : Utils.parseElapsed(row.time);
        }
        const v = Number(row[key]);
        return Number.isFinite(v) ? v : null;
      };

      let exps = Storage.state.experiments.filter((e) => this.selectedIds.has(e.id));
      // Polarization 모드에선 IV 유형만 표시
      if (this.mode === "polar") exps = exps.filter((e) => e.type === "iv");

      this.chart.data.datasets = exps.map((exp, i) => {
        const color = PALETTE[i % PALETTE.length];
        const cell = this._cellOf(exp);
        // X 기준 오름차순 정렬된 {x,y} 포인트 (null 제외)
        const points = exp.data
          .map((row) => ({ x: valueOf(row, xKey), y: valueOf(row, yKey) }))
          .filter((p) => p.x !== null && p.y !== null)
          .sort((a, b) => a.x - b.x);
        return {
          label: `${exp.name} · ${exp.meaName}${cell ? ` (${cell}-cell)` : ""}`,
          data: points,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.2,
        };
      });

      // 축 제목 갱신
      this.chart.options.scales.x.title.text = `${xDef.label} (${xDef.unit})`;
      this.chart.options.scales.y.title.text = `${yDef.label} (${yDef.unit})`;
      this.chart.update("none");

      // 통계 요약도 함께 갱신
      this.renderStats(exps);
    },

    /** 비교 그래프를 PNG 로 저장 (배경 채움) */
    exportPNG() {
      if (!this.chart || !this.chart.data.datasets.length) {
        Utils.toast("비교할 Experiment 를 먼저 선택하세요.");
        return;
      }
      const src = this.chart.canvas;
      const out = document.createElement("canvas");
      out.width = src.width;
      out.height = src.height;
      const ctx = out.getContext("2d");
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue("--card-bg").trim() || "#ffffff";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0);
      out.toBlob((blob) => {
        if (!blob) { Utils.toast("⚠ PNG 변환 실패"); return; }
        const tag = this.mode === "polar" ? "Polarization" : "Comparison";
        Utils.downloadBlob(blob, `${tag}_${Utils.fileTimestamp()}.png`);
        Utils.toast("비교 그래프를 PNG로 저장했습니다.");
      }, "image/png");
    },

    /* ---------------- 통계 요약 ---------------- */

    /** 숫자 배열의 기본 통계 계산 */
    _stats(values) {
      const nums = values.filter((v) => Number.isFinite(v));
      if (!nums.length) return null;
      const n = nums.length;
      const avg = nums.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(nums.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
      return { n, avg, std, min: Math.min(...nums), max: Math.max(...nums) };
    },

    /**
     * 선택된 Experiment 별 기본 통계 테이블 렌더링
     * (Cell Voltage 평균/표준편차/최소/최대, 전류밀도·온도 평균)
     */
    renderStats(exps) {
      const tbody = document.getElementById("statsTbody");
      if (!tbody) return;

      if (!exps.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-msg">비교할 Experiment 를 선택하면 통계가 표시됩니다.</td></tr>`;
        return;
      }

      const f = (v, d = 3) => (v === null || v === undefined ? "-" : v.toFixed(d));
      tbody.innerHTML = exps
        .map((exp) => {
          const num = (key) => exp.data.map((r) => Number(r[key]));
          const cv = this._stats(num("cellVoltage"));
          const cd = this._stats(num("currentDensity"));
          const tp = this._stats(num("temperature"));
          return `
          <tr>
            <td class="stats-name">${exp.name}<br/><small>${exp.meaName}</small></td>
            <td><span class="type-badge ${exp.type === "iv" ? "type-iv" : ""}">${exp.type === "iv" ? "IV" : "안정성"}</span></td>
            <td>${exp.data.length}</td>
            <td>${f(cv?.avg)}</td>
            <td>${f(cv?.std, 4)}</td>
            <td>${f(cv?.min)}</td>
            <td>${f(cv?.max)}</td>
            <td>${f(cd?.avg)}</td>
            <td>${f(tp?.avg, 1)}</td>
          </tr>`;
        })
        .join("");
    },
  };

  // 데이터 분석 페이지 진입 시 갱신
  document.addEventListener("page:changed", (e) => {
    if (e.detail.page === "page-analysis") {
      try { Analysis.refresh(); }
      catch (err) { console.error("[Analysis] 갱신 실패:", err); }
    }
  });

  // 전역 노출 (향후 다른 모듈에서 재사용 가능)
  window.Analysis = Analysis;
})();
