/* ============================================================
 * utils.js - 공통 유틸리티 함수 모음
 * 모든 모듈이 공유하는 순수 함수들.
 * window.Utils 네임스페이스로 노출한다. (file:// 환경에서도
 * 동작하도록 ES Module 대신 전역 네임스페이스 패턴 사용)
 * ============================================================ */
(function () {
  "use strict";

  const Utils = {

    /**
     * 초 단위 경과시간을 hh:mm:ss 문자열로 변환
     * @param {number} totalSeconds - 경과 초
     * @returns {string} "hh:mm:ss"
     */
    formatElapsed(totalSeconds) {
      const sec = Math.max(0, Math.floor(totalSeconds));
      const h = String(Math.floor(sec / 3600)).padStart(2, "0");
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
      const s = String(sec % 60).padStart(2, "0");
      return `${h}:${m}:${s}`;
    },

    /**
     * "hh:mm:ss" 문자열을 초 단위 숫자로 변환 (그래프 X축 정렬용)
     * @param {string} hms
     * @returns {number} 초
     */
    parseElapsed(hms) {
      if (typeof hms !== "string") return 0;
      const parts = hms.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return Number(hms) || 0;
    },

    /** 오늘 날짜를 "YYYY-MM-DD" 로 반환 (date input 용) */
    todayString() {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    },

    /** 현재 시각을 "HH:MM:SS" 로 반환 (실시간 시계 용) */
    nowClock() {
      const d = new Date();
      return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((v) => String(v).padStart(2, "0"))
        .join(":");
    },

    /** 파일명에 쓰기 좋은 타임스탬프 "YYYYMMDD_HHMMSS" */
    fileTimestamp() {
      const d = new Date();
      const p = (v) => String(v).padStart(2, "0");
      return (
        `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
      );
    },

    /**
     * 고유 ID 생성 (MEA, Experiment 식별용)
     * @param {string} prefix
     */
    uid(prefix = "id") {
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    },

    /**
     * 숫자를 지정 소수점 자리로 표시. 값이 없으면 빈 문자열.
     * @param {number|string|null} value
     * @param {number} digits
     */
    fmtNum(value, digits = 3) {
      if (value === null || value === undefined || value === "") return "";
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(digits) : "";
    },

    /**
     * 안전한 나눗셈 - 분모가 0/비어있으면 null 반환 (자동 계산용)
     * @param {number} a 분자
     * @param {number} b 분모
     */
    safeDivide(a, b) {
      // 빈 값("" / null / undefined)은 "측정 안 함"으로 간주 → null
      if (a === "" || a === null || a === undefined) return null;
      if (b === "" || b === null || b === undefined) return null;
      const x = Number(a), y = Number(b);
      if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null;
      return x / y;
    },

    /** 깊은 복사 (LocalStorage 저장 전 상태 분리용) */
    deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    },

    /**
     * HTML/SVG 텍스트 이스케이프
     * 사용자가 입력한 층 이름·MEA 이름을 innerHTML 로 넣을 때 마크업이
     * 깨지지 않도록 방어한다.
     */
    escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    },

    /**
     * Blob 을 파일로 다운로드 (JSON/CSV/PNG/XLSX 공용)
     * @param {Blob} blob
     * @param {string} filename
     */
    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 메모리 누수 방지
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    /**
     * 토스트 알림 표시
     * @param {string} message
     * @param {number} duration - 표시 시간(ms)
     */
    toast(message, duration = 2200) {
      const el = document.getElementById("toast");
      if (!el) return;
      el.textContent = message;
      el.classList.add("show");
      clearTimeout(Utils._toastTimer);
      Utils._toastTimer = setTimeout(() => el.classList.remove("show"), duration);
    },

    /**
     * 간단한 debounce - 잦은 입력 이벤트로 인한 성능 저하 방지
     * @param {Function} fn
     * @param {number} wait
     */
    debounce(fn, wait = 300) {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
      };
    },
  };

  // 전역 노출
  window.Utils = Utils;
})();
