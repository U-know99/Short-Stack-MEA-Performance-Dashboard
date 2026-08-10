/* ============================================================
 * chart.js - 실시간 그래프 모듈 (Chart.js 사용)
 *
 * - X축 : 경과 시간(hh:mm:ss)
 * - Y축 : 좌(전압 계열) / 우(전류·온도·전류밀도) 이중 축
 * - 체크박스로 표시 항목 즉시 전환
 * - 대량 데이터 대응: update("none") 으로 애니메이션 생략,
 *   포인트 반경 축소로 렌더링 부하 최소화
 *
 * ※ 파일명이 라이브러리(libs/chart.umd.min.js)와 같지만
 *   이 파일은 앱 전용 래퍼 모듈이다.
 * ============================================================ */
(function () {
  "use strict";

  /**
   * 측정 계열 정의 (확장 지점)
   * - 새 측정 항목을 추가하려면 여기에 한 줄만 추가하면
   *   체크박스/데이터셋/내보내기까지 자동 반영된다.
   * - axis: "yLeft"(전압 계열) | "yRight"(그 외)
   */
  const SERIES_DEFS = [
    { key: "voltage",        label: "Voltage (V)",           color: "#1e6ed4", axis: "yLeft"  },
    { key: "cellVoltage",    label: "Cell Voltage (V)",      color: "#7c4fd0", axis: "yLeft"  },
    { key: "current",        label: "Current (A)",           color: "#d64550", axis: "yRight" },
    { key: "currentDensity", label: "Current Density (A/cm²)", color: "#d99114", axis: "yRight" },
    { key: "temperature",    label: "Temperature (℃)",       color: "#1f9d61", axis: "yRight" },
  ];

  /** IV Curve 축 선택 옵션 (time 포함) */
  const IV_AXIS_OPTIONS = [
    { key: "time",           label: "Time",            unit: "hh:mm:ss" },
    { key: "currentDensity", label: "Current Density", unit: "A/cm²" },
    { key: "current",        label: "Current",         unit: "A" },
    { key: "voltage",        label: "Voltage",         unit: "V" },
    { key: "cellVoltage",    label: "Cell Voltage",    unit: "V" },
    { key: "temperature",    label: "Temperature",     unit: "℃" },
  ];

  const LiveChart = {

    /** Chart.js 인스턴스 */
    chart: null,
    /** IV Curve 인스턴스 */
    ivChart: null,

    /** 계열 정의 외부 공개 (export.js 등에서 재사용) */
    SERIES_DEFS,

    /**
     * 초기화
     * @param {object} visibleSeries - { key: boolean } 표시 여부 설정
     * @param {Function} onToggle - 체크박스 변경 시 콜백(key, checked)
     * @param {object} ivAxes - IV Curve 축 설정 { x, y }
     * @param {Function} onIvAxisChange - IV 축 변경 시 콜백(x, y)
     */
    init(visibleSeries, onToggle, ivAxes, onIvAxisChange) {
      this._buildCheckboxes(visibleSeries, onToggle);
      this._buildChart(visibleSeries);
      this._buildIvChart(ivAxes || { x: "currentDensity", y: "cellVoltage" }, onIvAxisChange);
    },

    /** 표시 항목 체크박스 생성 */
    _buildCheckboxes(visibleSeries, onToggle) {
      const box = document.getElementById("seriesChecks");
      const frag = document.createDocumentFragment();

      SERIES_DEFS.forEach((def) => {
        const label = document.createElement("label");
        label.innerHTML = `
          <input type="checkbox" data-key="${def.key}" ${visibleSeries[def.key] ? "checked" : ""}/>
          <span class="series-dot" style="background:${def.color}"></span>
          ${def.label}`;
        frag.appendChild(label);
      });
      box.replaceChildren(frag);

      // 체크박스 변경 → 즉시 그래프 표시/숨김 전환
      box.addEventListener("change", (e) => {
        const input = e.target.closest("input[data-key]");
        if (!input) return;
        this.setSeriesVisible(input.dataset.key, input.checked);
        if (onToggle) onToggle(input.dataset.key, input.checked);
      });
    },

    /** Chart.js 라인 차트 생성 */
    _buildChart(visibleSeries) {
      const ctx = document.getElementById("mainChart").getContext("2d");
      const css = getComputedStyle(document.documentElement);
      const gridColor = css.getPropertyValue("--border").trim();
      const textColor = css.getPropertyValue("--text-sub").trim();

      this.chart = new Chart(ctx, {
        type: "line",
        data: {
          labels: [], // hh:mm:ss 문자열
          datasets: SERIES_DEFS.map((def) => ({
            label: def.label,
            data: [],
            borderColor: def.color,
            backgroundColor: def.color,
            yAxisID: def.axis,
            hidden: !visibleSeries[def.key],
            tension: 0.25,       // 부드러운 곡선
            pointRadius: 2.5,    // 포인트 작게 → 대량 데이터 성능
            pointHoverRadius: 5,
            borderWidth: 2,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false, // 실시간 갱신 성능 우선
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false }, // 자체 체크박스 UI 사용
            tooltip: {
              callbacks: {
                title: (items) => `Time ${items[0]?.label ?? ""}`,
              },
            },
          },
          scales: {
            x: {
              title: { display: true, text: "Time (hh:mm:ss)", color: textColor },
              ticks: { color: textColor, maxTicksLimit: 12, autoSkip: true },
              grid: { color: gridColor },
            },
            yLeft: {
              position: "left",
              title: { display: true, text: "Voltage (V)", color: textColor },
              ticks: { color: textColor },
              grid: { color: gridColor },
            },
            yRight: {
              position: "right",
              title: { display: true, text: "Current / Temp / C.D.", color: textColor },
              ticks: { color: textColor },
              grid: { drawOnChartArea: false }, // 오른쪽 축 격자선은 겹치지 않게 숨김
            },
          },
        },
      });
    },

    /**
     * rows 데이터로 그래프 전체 갱신 (실시간 + IV Curve 동시)
     * @param {Array} rows - 측정 데이터
     */
    update(rows) {
      this._lastRows = rows; // IV 축 변경 시 재사용
      if (this.chart) {
        this.chart.data.labels = rows.map((r) => r.time);
        SERIES_DEFS.forEach((def, i) => {
          this.chart.data.datasets[i].data = rows.map((r) => {
            const v = Number(r[def.key]);
            return Number.isFinite(v) ? v : null; // 빈 값은 선 끊김으로 표현
          });
        });
        this.chart.update("none"); // 애니메이션 없이 즉시 반영
      }
      this.updateIv(rows);
    },

    /* ============================================================
     * IV Curve (X/Y축 자유 선택, X 기준 정렬)
     * ============================================================ */

    /** IV Curve 생성 + 축 선택 드롭다운 구성 */
    _buildIvChart(ivAxes, onIvAxisChange) {
      const xSel = document.getElementById("ivAxisX");
      const ySel = document.getElementById("ivAxisY");
      if (!xSel || !ySel) return;

      const optionsHtml = IV_AXIS_OPTIONS
        .map((o) => `<option value="${o.key}">${o.label} (${o.unit})</option>`)
        .join("");
      xSel.innerHTML = optionsHtml;
      ySel.innerHTML = optionsHtml;
      xSel.value = ivAxes.x || "currentDensity";
      ySel.value = ivAxes.y || "cellVoltage";

      [xSel, ySel].forEach((sel) =>
        sel.addEventListener("change", () => {
          this.updateIv(this._lastRows || []);
          if (onIvAxisChange) onIvAxisChange(xSel.value, ySel.value);
        })
      );

      const css = getComputedStyle(document.documentElement);
      const gridColor = css.getPropertyValue("--border").trim();
      const textColor = css.getPropertyValue("--text-sub").trim();
      const ctx = document.getElementById("ivChart").getContext("2d");

      this.ivChart = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [{
            label: "IV",
            data: [],
            borderColor: "#d64550",
            backgroundColor: "#d64550",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          parsing: false, // {x,y} 직접 공급
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => {
                  const x = items[0]?.parsed?.x;
                  return xSel.value === "time" ? Utils.formatElapsed(x) : String(x);
                },
              },
            },
          },
          scales: {
            x: {
              type: "linear",
              title: { display: true, text: "", color: textColor },
              ticks: {
                color: textColor,
                callback: (v) => (xSel.value === "time" ? Utils.formatElapsed(v) : v),
              },
              grid: { color: gridColor },
            },
            y: {
              title: { display: true, text: "", color: textColor },
              ticks: { color: textColor },
              grid: { color: gridColor },
            },
          },
        },
      });
      this.updateIv([]);
    },

    /** 행 데이터에서 축 값 추출 (time 은 초 단위 숫자) */
    _ivValue(row, key) {
      if (key === "time") {
        const v = Number(row.elapsedSec);
        return Number.isFinite(v) ? v : Utils.parseElapsed(row.time);
      }
      const v = Number(row[key]);
      return Number.isFinite(v) ? v : null;
    },

    /** IV Curve 갱신 (X 오름차순 정렬) */
    updateIv(rows) {
      if (!this.ivChart) return;
      const xKey = document.getElementById("ivAxisX")?.value || "currentDensity";
      const yKey = document.getElementById("ivAxisY")?.value || "cellVoltage";
      const xDef = IV_AXIS_OPTIONS.find((o) => o.key === xKey);
      const yDef = IV_AXIS_OPTIONS.find((o) => o.key === yKey);

      this.ivChart.data.datasets[0].data = (rows || [])
        .map((r) => ({ x: this._ivValue(r, xKey), y: this._ivValue(r, yKey) }))
        .filter((p) => p.x !== null && p.y !== null)
        .sort((a, b) => a.x - b.x);

      this.ivChart.options.scales.x.title.text = `${xDef.label} (${xDef.unit})`;
      this.ivChart.options.scales.y.title.text = `${yDef.label} (${yDef.unit})`;
      this.ivChart.update("none");
    },

    /** IV Curve 를 PNG Blob 으로 (배경 채움) */
    ivToPngBlob() {
      return new Promise((resolve) => {
        if (!this.ivChart) { resolve(null); return; }
        const src = this.ivChart.canvas;
        const out = document.createElement("canvas");
        out.width = src.width;
        out.height = src.height;
        const ctx = out.getContext("2d");
        const bg = getComputedStyle(document.documentElement)
          .getPropertyValue("--card-bg").trim() || "#ffffff";
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(src, 0, 0);
        out.toBlob((blob) => resolve(blob), "image/png");
      });
    },

    /** 특정 계열 표시/숨김 */
    setSeriesVisible(key, visible) {
      const idx = SERIES_DEFS.findIndex((d) => d.key === key);
      if (idx < 0 || !this.chart) return;
      this.chart.setDatasetVisibility(idx, visible);
      this.chart.update("none");
    },

    /** 테마 전환 시 축/격자 색상 갱신 (실시간 + IV 모두) */
    applyTheme() {
      const css = getComputedStyle(document.documentElement);
      const gridColor = css.getPropertyValue("--border").trim();
      const textColor = css.getPropertyValue("--text-sub").trim();

      if (this.chart) {
        const { x, yLeft, yRight } = this.chart.options.scales;
        [x, yLeft, yRight].forEach((axis) => {
          axis.ticks.color = textColor;
          if (axis.title) axis.title.color = textColor;
          if (axis.grid && axis !== yRight) axis.grid.color = gridColor;
        });
        this.chart.update("none");
      }
      if (this.ivChart) {
        const { x, y } = this.ivChart.options.scales;
        [x, y].forEach((axis) => {
          axis.ticks.color = textColor;
          if (axis.title) axis.title.color = textColor;
          if (axis.grid) axis.grid.color = gridColor;
        });
        this.ivChart.update("none");
      }
    },

    /**
     * 그래프를 PNG Blob 으로 변환 (PNG 저장 버튼)
     * - 투명 배경 대신 카드 배경색을 깔아 저장
     * @returns {Promise<Blob>}
     */
    toPngBlob() {
      return new Promise((resolve) => {
        if (!this.chart) { resolve(null); return; } // 그래프 미생성 시 안전 처리
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
        out.toBlob((blob) => resolve(blob), "image/png");
      });
    },
  };

  // 전역 노출
  window.LiveChart = LiveChart;
})();
