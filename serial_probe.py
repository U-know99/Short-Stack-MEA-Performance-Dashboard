#!/usr/bin/env python3
"""
AD Power HPM-300A 시리얼 데이터 진단 스크립트
------------------------------------------------
목적: 장비가 RS-232 로 실제로 어떤 데이터를 보내는지 캡처한다.
     (S…E 프레임의 실제 형식을 확인해 파서를 만들기 위함)

프로토콜(매뉴얼 기준):
  - PC → 장비 : 'S#'  전송 시작 명령
  - 장비 → PC : 약 0.5초 주기로 'S'로 시작 'E'로 끝나는 데이터 프레임 연속 전송
  - PC → 장비 : 'E#'  전송 중지 명령

사용법:
  1) 의존성 설치:  pip install pyserial
  2) 아래 PORT 값을 실제 포트로 변경
       - Windows: "COM3" (장치관리자 > 포트(COM & LPT) 확인)
       - Mac    : "/dev/tty.usbserial-XXXX"  (ls /dev/tty.* 로 확인)
  3) 실행:  python serial_probe.py
  4) 15초간 캡처된 결과(raw_capture.txt)를 그대로 복사해 전달

BAUD(통신속도)를 모르면 COMMON_BAUDS 를 순서대로 자동 시도한다.
"""

import sys, time, datetime

try:
    import serial            # pyserial
    import serial.tools.list_ports as list_ports
except ImportError:
    print("[!] pyserial 이 필요합니다.  먼저 실행:  pip install pyserial")
    sys.exit(1)

# ===== 설정 =====
PORT = "/dev/cu.usbserial-D200NEE6"   # 예: "COM3" 또는 "/dev/tty.usbserial-1420".  비워두면 포트 목록만 출력
COMMON_BAUDS = [9600, 19200, 38400, 4800, 57600, 115200]
CAPTURE_SECONDS = 15
OUT_FILE = "raw_capture.txt"
# ================


def list_available_ports():
    ports = list(list_ports.comports())
    print("\n=== 사용 가능한 시리얼 포트 ===")
    if not ports:
        print("  (없음) 케이블 연결과 USB-시리얼 드라이버를 확인하세요.")
    for p in ports:
        print(f"  {p.device:20}  {p.description}")
    print("================================\n")
    return ports


def probe(port, baud, log):
    """지정 포트/보드레이트로 열고 S# 전송 후 데이터 캡처. 유효 데이터 수신 여부 반환."""
    line = f"\n----- 시도: {port} @ {baud} bps -----"
    print(line); log.write(line + "\n")
    try:
        ser = serial.Serial(port, baud, timeout=1,
                            bytesize=serial.EIGHTBITS,
                            parity=serial.PARITY_NONE,
                            stopbits=serial.STOPBITS_ONE)
    except Exception as e:
        msg = f"  [!] 포트 열기 실패: {e}"
        print(msg); log.write(msg + "\n")
        return False

    got = 0
    try:
        time.sleep(0.3)
        ser.reset_input_buffer()
        ser.write(b"S#")          # 데이터 전송 시작 명령
        ser.flush()
        print(f"  'S#' 전송, {CAPTURE_SECONDS}초간 수신 대기...")

        end = time.time() + CAPTURE_SECONDS
        while time.time() < end:
            data = ser.read(256)
            if data:
                got += len(data)
                ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
                hexs = data.hex(" ")
                asc = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
                block = f"[{ts}] ({len(data):3}B)\n  ASCII: {asc}\n  HEX  : {hexs}"
                print(block); log.write(block + "\n")
        ser.write(b"E#")          # 전송 중지 명령
        ser.flush()
    finally:
        ser.close()

    result = f"  => 수신 바이트: {got}"
    print(result); log.write(result + "\n")
    return got > 0


def main():
    ports = list_available_ports()

    with open(OUT_FILE, "w", encoding="utf-8") as log:
        log.write(f"AD Power HPM-300A 시리얼 캡처 - {datetime.datetime.now()}\n")

        if not PORT:
            print("[i] 스크립트 상단의 PORT 값을 위 목록 중 하나로 설정한 뒤 다시 실행하세요.")
            log.write("PORT 미설정 - 포트 목록만 기록\n")
            return

        # BAUD 자동 탐색: 데이터가 잡히는 첫 보드레이트에서 멈춤
        for baud in COMMON_BAUDS:
            if probe(PORT, baud, log):
                print(f"\n[✓] {baud} bps 에서 데이터 수신됨. 이 값을 브리지에 사용하세요.")
                log.write(f"\n성공 보드레이트: {baud}\n")
                break
        else:
            print("\n[!] 어떤 보드레이트에서도 데이터가 안 잡혔습니다.")
            print("    확인: (1) 전용 데이터 케이블 사용 여부  (2) 포트 번호  (3) 장비 전원/통신모드")

    print(f"\n결과가 '{OUT_FILE}' 에 저장되었습니다. 이 파일 내용을 그대로 전달해 주세요.")


if __name__ == "__main__":
    main()
