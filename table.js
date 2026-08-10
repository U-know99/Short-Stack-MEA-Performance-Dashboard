/* ============================================================
 * table.js - 측정 데이터 테이블 렌더링/조작 모듈
 *
 * - rows 배열(단일 소스)을 받아 <tbody> 를 렌더링
 * - 행 클릭 선택 → "행 삭제" 버튼과 연동
 * - 데이터가 많아져도 느려지지 않도록 DocumentFragment 로
 *   한 번에 DOM 삽입 (행 단위 append 반복 없음)
 * ============================================================ */
(function () {
  "use strict";

  const DataTable = {

    /** 현재 선택(하이라이트)된 행 인덱스. 없으면 -1 */
    selectedIndex: -1,

    /** tbody 엘리먼트 캐시 */
    _tbody: null,

    /** 초기화 - 행 클릭 선택 이벤트 위임 등록 */
    init() {
      this._tbody = document.getElementById("dataTbody");

      // 이벤트 위임: 행이 수천 개여도 리스너는 1개만 유지 (성능)
      this._tbody.addEventListener("click", (e) => {
        // 행 개별 삭제 버튼
        const delBtn = e.target.closest(".row-del");
        if (delBtn) {
          const idx = Number(delBtn.dataset.index);
          document.dispatchEvent(new CustomEvent("table:deleteRow", { detail: { index: idx } }));
          return;
        }
        // 행 클릭 → 편집 모달 열기
        const tr = e.target.closest("tr");
        if (!tr) return;
        const idx = Number(tr.dataset.index);
        document.dispatchEvent(new CustomEvent("table:editRow", { detail: { index: idx } }));
      });
    },

    /**
     * rows 전체를 다시 렌더링
     * @param {Array} rows - 측정 데이터 배열
     */
    render(rows) {
      const frag = document.createDocumentFragment();

      rows.forEach((row, i) => {
        const tr = document.createElement("tr");
        tr.dataset.index = i;
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td>${row.time}</td>
          <td>${Utils.fmtNum(row.temperature, 1)}</td>
          <td>${Utils.fmtNum(row.voltage, 3)}</td>
          <td>${Utils.fmtNum(row.current, 2)}</td>
          <td>${Utils.fmtNum(row.currentDensity, 3)}</td>
          <td title="${row.cellVoltages?.length
            ? "셀별 (Top→Bot): " + row.cellVoltages.map((v) => (v ?? "-")).join(" / ")
            : ""}">${Utils.fmtNum(row.cellVoltage, 3)}</td>
          <td><button class="row-del" data-index="${i}" title="이 행 삭제">
                <i class="bi bi-x-lg"></i></button></td>`;
        frag.appendChild(tr);
      });

      // 한 번의 교체로 렌더링 (reflow 최소화)
      this._tbody.replaceChildren(frag);

      // 삭제 후 인덱스가 범위를 벗어나면 선택 해제
      if (this.selectedIndex >= rows.length) this.selectedIndex = -1;
      this._applySelection();

      // 새 행 추가 시 테이블을 맨 아래로 스크롤
      const wrap = document.getElementById("tableWrap");
      wrap.scrollTop = wrap.scrollHeight;
    },

    /** 선택 행 하이라이트 갱신 */
    _applySelection() {
      [...this._tbody.children].forEach((tr, i) => {
        tr.classList.toggle("row-selected", i === this.selectedIndex);
      });
    },

    /** 선택 해제 */
    clearSelection() {
      this.selectedIndex = -1;
      this._applySelection();
    },
  };

  // 전역 노출
  window.DataTable = DataTable;
})();
