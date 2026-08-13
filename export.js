/* ============================================================
 * export.js - 데이터 내보내기 모듈
 *  - JSON  : 전체 상태 백업/복원
 *  - CSV   : 현재 측정 데이터
 *  - XLSX  : 저장된 Experiment 별 시트 (SheetJS 사용)
 *  - PNG   : 그래프 이미지
 * ============================================================ */
(function () {
  "use strict";

  /** CSV/XLSX 공용 컬럼 정의 (측정 항목 확장 시 여기만 수정) */
  const EXPORT_COLUMNS = [
    { key: "time",           header: "Time (hh:mm:ss)" },
    { key: "temperature",    header: "Temperature (C)" },
    { key: "voltage",        header: "Voltage (V)" },
    { key: "current",        header: "Current (A)" },
    { key: "currentDensity", header: "Current Density (A/cm2)" },
    { key: "cellVoltage",    header: "Cell Voltage Avg (V)" },
    { key: "cellVoltages",   header: "Cell Voltages Top->Bot (V)" }, // 셀별 개별값
    { key: "totalCellVoltage", header: "Total Cell Voltage AC Clamp (V)" },
  ];

  /** 내보내기용 값 변환 (배열은 " / " 로 연결) */
  function exportValue(row, key) {
    const v = row[key];
    if (Array.isArray(v)) return v.map((x) => (x ?? "")).join(" / ");
    return v;
  }

  const Exporter = {

    /* ---------------- JSON ---------------- */

    /** 전체 상태를 JSON 파일로 다운로드 */
    saveJSON() {
      const json = Storage.exportJSON();
      const blob = new Blob([json], { type: "application/json" });
      Utils.downloadBlob(blob, `MEA_Dashboard_${Utils.fileTimestamp()}.json`);
      Utils.toast("JSON 파일로 저장했습니다.");
    },

    /**
     * 배포용 data.json 저장
     * - 전체 상태에 publishedAt(발행 시각)을 찍어 "data.json" 이름으로 저장
     * - 이 파일을 index.html 과 같은 GitHub 폴더에 올리면
     *   github.io 방문자가 접속 시 자동으로 불러온다.
     */
    savePublishJSON() {
      const state = JSON.parse(Storage.exportJSON());
      state.publishedAt = Date.now();
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      Utils.downloadBlob(blob, "data.json");
      Utils.toast("data.json 저장 완료. GitHub 폴더(index.html 옆)에 올린 뒤 push 하세요.", 5000);
    },

    /**
     * JSON 파일을 읽어 전체 상태 복원
     * @param {File} file - <input type="file"> 에서 받은 파일
     * @param {Function} onDone - 복원 완료 후 UI 갱신 콜백
     */
    loadJSON(file, onDone) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Storage.importJSON(String(reader.result));
          Utils.toast("저장된 대시보드 데이터를 불러왔습니다.");
          if (onDone) onDone();
        } catch (err) {
          console.error("[Exporter] JSON 복원 실패:", err);
          Utils.toast("⚠ JSON 파일을 읽을 수 없습니다: " + err.message, 3500);
        }
      };
      reader.onerror = () => Utils.toast("⚠ 파일 읽기에 실패했습니다.");
      reader.readAsText(file, "utf-8");
    },

    /* ---------------- CSV ---------------- */

    /** CSV 한 셀 이스케이프 (쉼표/따옴표/줄바꿈 포함 시 큰따옴표로 감쌈) */
    _csvCell(v) {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    },

    /**
     * 선택한 데이터셋들을 CSV 로 내보낸다.
     * - 여러 개면 맨 앞에 Experiment 컬럼을 추가해 하나의 CSV 로 합침
     * @param {Array<{name, data}>} datasets
     */
    saveCSV(datasets) {
      const list = (datasets || []).filter((d) => d.data && d.data.length);
      if (!list.length) {
        Utils.toast("내보낼 데이터가 없습니다.");
        return;
      }
      const multi = list.length > 1;
      const header = (multi ? ["Experiment"] : [])
        .concat(EXPORT_COLUMNS.map((c) => c.header))
        .map((h) => this._csvCell(h)).join(",");

      const lines = [];
      list.forEach((ds) => {
        ds.data.forEach((row) => {
          const cells = (multi ? [ds.name] : [])
            .concat(EXPORT_COLUMNS.map((c) => exportValue(row, c.key)))
            .map((v) => this._csvCell(v));
          lines.push(cells.join(","));
        });
      });

      const csv = "﻿" + [header, ...lines].join("\r\n"); // BOM + CRLF
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const base = multi ? "Experiments" : (list[0].name || "data");
      const name = base.replace(/[\\/:*?"<>|]/g, "_");
      Utils.downloadBlob(blob, `${name}_${Utils.fileTimestamp()}.csv`);
      Utils.toast(`CSV 로 내보냈습니다. (${list.length}개 데이터셋)`);
    },

    /* ---------------- XLSX (SheetJS) ---------------- */

    /**
     * 저장된 Experiment 들을 실험별 시트로 xlsx 저장
     * - 시트 이름 = Experiment 이름
     * - 각 시트 상단에 메타(조건) 블록 + 측정 데이터 테이블
     * @param {Array} experiments
     */
    saveXLSX(experiments) {
      // 라이브러리 로드 실패 시 조용히 죽지 않고 원인을 알려준다
      if (typeof XLSX === "undefined") {
        Utils.toast("⚠ Excel 라이브러리(libs/xlsx.full.min.js)를 찾을 수 없습니다. libs 폴더를 확인하세요.", 4500);
        return;
      }
      if (!experiments.length) {
        Utils.toast("저장된 Experiment가 없습니다. 먼저 '실험 저장'을 하세요.");
        return;
      }

      const wb = XLSX.utils.book_new();
      const usedNames = new Set(); // 시트 이름 중복 방지 (Excel 은 중복 시트명 불가)

      experiments.forEach((exp, idx) => {
        // --- 메타 정보 블록 (MEA 사양 + 실험 조건 + 메모) ---
        // 사양(specs)은 신버전, 구버전 데이터는 conditions 에서 fallback
        const specs = exp.specs || {};
        const cond = exp.conditions || {};
        const meta = [
          ["Experiment", exp.name],
          ["Type", exp.type === "iv" ? "IV (Polarization)" : "Stability"],
          ["MEA", exp.meaName],
          ["Date", exp.date],
          ["Operator", exp.operator || ""],
          ["Memo", exp.memo || ""],
          ["-- MEA Specs --", ""],
          ["Vendor", specs.vendor ?? ""],
          ["Fabrication Date", specs.fabricationDate ?? ""],
          ["Membrane", specs.membrane ?? ""],
          ["Membrane Thickness (um)", specs.membraneThickness ?? ""],
          ["Anode Catalyst", specs.anodeCatalyst ?? ""],
          ["Anode Loading (mg/cm2)", specs.anodeLoading ?? ""],
          ["Cathode Catalyst", specs.cathodeCatalyst ?? ""],
          ["Cathode Loading (mg/cm2)", specs.cathodeLoading ?? ""],
          ["Anode PTL", specs.anodePtl ?? ""],
          ["Cathode GDL", specs.cathodeGdl ?? ""],
          ["Active Area (cm2)", specs.activeArea ?? cond.activeArea ?? ""],
          ["-- Conditions --", ""],
          ["Evaluation Cell Count", cond.cellCount ?? specs.cellCount ?? ""],
          ["Temperature (C)", cond.temperature ?? ""],
          ["Pressure (bar)", cond.pressure ?? ""],
          [`Flow Rate (${cond.flowRateUnit || "mL/min"})`, cond.flowRate ?? ""],
          ["Remark", cond.remark ?? ""],
          [], // 빈 줄
          EXPORT_COLUMNS.map((c) => c.header), // 데이터 헤더
        ];

        // --- 측정 데이터 행 ---
        const dataRows = exp.data.map((row) =>
          EXPORT_COLUMNS.map((c) => {
            const v = exportValue(row, c.key);
            // 숫자는 숫자 타입으로 저장해 Excel 에서 바로 계산 가능
            const n = Number(v);
            return c.key !== "time" && typeof v !== "string" && Number.isFinite(n) && v !== "" && v !== null ? n : (v ?? "");
          })
        );

        const ws = XLSX.utils.aoa_to_sheet([...meta, ...dataRows]);
        // 열 너비 지정 (가독성)
        ws["!cols"] = EXPORT_COLUMNS.map(() => ({ wch: 18 }));

        // 시트 이름: Excel 제한(31자, 특수문자) 처리 + 중복 방지
        // (같은 이름의 Experiment 가 여러 개면 시트가 하나만 남던 버그 수정)
        let base = (exp.name || `Experiment ${idx + 1}`).replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
        let sheetName = base, n = 2;
        while (usedNames.has(sheetName.toLowerCase())) {
          const suffix = ` (${n++})`;
          sheetName = base.slice(0, 31 - suffix.length) + suffix;
        }
        usedNames.add(sheetName.toLowerCase());
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      XLSX.writeFile(wb, `MEA_Experiments_${Utils.fileTimestamp()}.xlsx`);
      Utils.toast(`Excel 파일로 내보냈습니다. (시트 ${experiments.length}개)`);
    },

    /* ---------------- PNG ---------------- */

    /** 현재 그래프를 PNG 이미지로 다운로드 */
    async savePNG() {
      const blob = await LiveChart.toPngBlob();
      if (!blob) {
        Utils.toast("⚠ 그래프 이미지를 만들 수 없습니다.");
        return;
      }
      Utils.downloadBlob(blob, `MEA_Chart_${Utils.fileTimestamp()}.png`);
      Utils.toast("그래프를 PNG로 저장했습니다.");
    },

    /* ============================================================
     * XLSX 불러오기 - 내보낸 Excel 을 다시 Experiment 로 되살린다
     *
     * saveXLSX 가 만든 형식(시트당 실험 1개, 상단 메타 블록 + 데이터 표)을
     * 그대로 역파싱한다. 백업 JSON 이 없어도 Excel 파일만 있으면 복구된다.
     * ============================================================ */

    /**
     * Excel 파일을 읽어 Experiment 목록으로 파싱 (저장은 하지 않는다)
     * @param {File} file
     * @returns {Promise<{experiments:Array, warnings:string[]}>}
     */
    parseXLSX(file) {
      return new Promise((resolve, reject) => {
        if (typeof XLSX === "undefined") {
          reject(new Error("Excel 라이브러리(libs/xlsx.full.min.js)를 찾을 수 없습니다."));
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
        reader.onload = () => {
          try {
            const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
            if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
              reject(new Error("시트를 찾지 못했습니다. Excel 파일이 맞는지 확인하세요."));
              return;
            }
            const experiments = [], warnings = [];

            wb.SheetNames.forEach((sheetName) => {
              const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
                header: 1, raw: true, defval: "",
              });
              const parsed = parseExperimentSheet(aoa, sheetName);
              if (parsed.error) warnings.push(`${sheetName}: ${parsed.error}`);
              else experiments.push(parsed.exp);
            });
            resolve({ experiments, warnings });
          } catch (err) {
            reject(new Error("Excel 형식을 해석하지 못했습니다: " + err.message));
          }
        };
        reader.readAsArrayBuffer(file);
      });
    },
  };

  /* ---------------- XLSX 역파싱 헬퍼 ---------------- */

  /** 헤더 문자열 → EXPORT_COLUMNS 의 key (괄호 단위 표기는 무시하고 매칭) */
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const HEADER_KEY = {};
  EXPORT_COLUMNS.forEach((c) => { HEADER_KEY[norm(c.header)] = c.key; });
  // 단위 표기가 바뀌어도(Flow Rate (V) 등) 붙잡을 수 있게 접두어로도 매칭
  const HEADER_PREFIX = EXPORT_COLUMNS.map((c) => ({
    key: c.key, pre: norm(c.header).split(" (")[0],
  }));

  function keyOfHeader(h) {
    const n = norm(h);
    if (HEADER_KEY[n]) return HEADER_KEY[n];
    const hit = HEADER_PREFIX.find((p) => n.startsWith(p.pre));
    return hit ? hit.key : null;
  }

  /** "1.72 / 1.70 / 1.75" → [1.72, 1.70, 1.75] (빈 값은 null) */
  function parseCellVoltages(v) {
    if (v === "" || v === null || v === undefined) return null;
    const parts = String(v).split("/").map((s) => s.trim());
    if (parts.every((s) => s === "")) return null;
    return parts.map((s) => (s === "" ? null : Number(s)));
  }

  const numOrNull = (v) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  /** "hh:mm:ss" → 초. 파싱 실패 시 null */
  function secOfTime(t) {
    const m = String(t ?? "").match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (!m) return null;
    return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }

  /**
   * 시트 한 장 → Experiment 객체
   * @param {Array<Array>} aoa - sheet_to_json(header:1) 결과
   * @param {string} sheetName
   */
  function parseExperimentSheet(aoa, sheetName) {
    // 1) 데이터 헤더 행 찾기 (Time 으로 시작하는 행)
    const hIdx = aoa.findIndex((r) => keyOfHeader(r && r[0]) === "time");
    if (hIdx < 0) return { error: "측정 데이터 표(Time 헤더)를 찾지 못했습니다." };

    // 2) 메타 블록 (헤더 행 위쪽의 라벨/값 쌍)
    const meta = {};
    for (let i = 0; i < hIdx; i++) {
      const label = String((aoa[i] || [])[0] ?? "").trim();
      if (!label || label.startsWith("--")) continue;
      meta[label] = (aoa[i] || [])[1];
    }
    const pick = (...names) => {
      for (const n of names) {
        const hit = Object.keys(meta).find((k) => norm(k) === norm(n) || norm(k).startsWith(norm(n)));
        if (hit && meta[hit] !== "" && meta[hit] !== undefined) return meta[hit];
      }
      return "";
    };

    // 3) 컬럼 위치 매핑
    const cols = (aoa[hIdx] || []).map(keyOfHeader);

    // 4) 측정 행
    const data = [];
    for (let i = hIdx + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      if (r.every((c) => c === "" || c === null || c === undefined)) continue;
      const row = {};
      cols.forEach((key, ci) => {
        if (!key) return;
        const v = r[ci];
        if (key === "time") row.time = String(v ?? "").trim();
        else if (key === "cellVoltages") row.cellVoltages = parseCellVoltages(v);
        else row[key] = numOrNull(v);
      });
      if (!row.time && row.voltage === null && row.current === null) continue;
      row.elapsedSec = secOfTime(row.time) ?? 0;
      data.push(row);
    }
    if (!data.length) return { error: "측정 데이터 행이 없습니다." };

    const typeRaw = norm(pick("Type"));
    const exp = {
      id: Utils.uid("exp"),
      name: String(pick("Experiment") || sheetName).trim(),
      type: typeRaw.includes("iv") || typeRaw.includes("polar") ? "iv" : "stability",
      meaId: null,                       // 아래 import 단계에서 이름으로 연결
      meaName: String(pick("MEA") || "").trim(),
      date: String(pick("Date") || Utils.todayString()).trim(),
      operator: String(pick("Operator") || "").trim(),
      memo: String(pick("Memo") || "").trim(),
      conditions: {
        cellCount: pick("Evaluation Cell Count"),
        temperature: pick("Temperature"),
        pressure: pick("Pressure"),
        flowRate: pick("Flow Rate"),
        activeArea: pick("Active Area"),
        remark: pick("Remark"),
      },
      specs: {
        vendor: pick("Vendor"),
        fabricationDate: pick("Fabrication Date"),
        membrane: pick("Membrane"),
        membraneThickness: pick("Membrane Thickness"),
        anodeCatalyst: pick("Anode Catalyst"),
        anodeLoading: pick("Anode Loading"),
        cathodeCatalyst: pick("Cathode Catalyst"),
        cathodeLoading: pick("Cathode Loading"),
        anodePtl: pick("Anode PTL"),
        cathodeGdl: pick("Cathode GDL"),
        activeArea: pick("Active Area"),
      },
      data,
      savedAt: new Date().toISOString(),
      importedFrom: "xlsx",
    };
    return { exp };
  }

  // 전역 노출
  window.Exporter = Exporter;
})();
