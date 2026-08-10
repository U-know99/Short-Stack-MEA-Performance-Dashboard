#!/usr/bin/env python3
"""
AD Power HPM-300A 시리얼 진단 v2 (응답이 없을 때)
--------------------------------------------------
1차 진단에서 데이터가 안 잡혀서, 여러 조합을 자동으로 시도한다:
  A) 아무 명령도 안 보내고 그냥 듣기 (장비가 스스로 흘려보내는 경우)
  B) 시작 명령 변형: 'S#', 'S#\r', 'S#\r\n'
  C) 제어선(DTR/RTS) 상태 조합
  D) 통신속도(baud) 9600 / 19200
어느 조합에서든 데이터가 들어오면 그 설정을 표시하고 멈춘다.

실행 전에 장비에서 값(전압/전류)이 화면에 보이는 측정 상태인지,
그리고 'PC 통신' 표시 아이콘을 켜는 버튼이 있는지 확인하세요.

사용:  python3 serial_probe2.py
"""
import sys, time, datetime

try:
    import serial
except ImportError:
    print("[!] pip install pyserial 먼저 실행"); sys.exit(1)

PORT = "/dev/cu.usbserial-D200NEE6"   # 1차에서 확인된 포트
BAUDS = [9600, 19200, 38400, 4800]
DTR_RTS = [(True, True), (False, False), (True, False), (False, True)]
START_CMDS = [b"S#", b"S#\r", b"S#\r\n", b"S\r"]
LISTEN_SEC = 5
CMD_SEC = 3
OUT = "raw_capture2.txt"


def attempt(log, baud, dtr, rts, cmd, seconds, label):
    head = f"\n[{label}] baud={baud} DTR={dtr} RTS={rts} cmd={cmd!r}"
    print(head); log.write(head + "\n")
    try:
        ser = serial.Serial()
        ser.port = PORT; ser.baudrate = baud; ser.timeout = 1
        ser.bytesize = serial.EIGHTBITS; ser.parity = serial.PARITY_NONE
        ser.stopbits = serial.STOPBITS_ONE
        ser.dtr = dtr; ser.rts = rts
        ser.open()
    except Exception as e:
        m = f"  포트 열기 실패: {e}"; print(m); log.write(m+"\n"); return False

    got = 0
    try:
        time.sleep(0.3); ser.reset_input_buffer()
        if cmd:
            ser.write(cmd); ser.flush()
        end = time.time() + seconds
        while time.time() < end:
            d = ser.read(256)
            if d:
                got += len(d)
                asc = "".join(chr(b) if 32 <= b < 127 else "." for b in d)
                blk = f"  << ({len(d)}B) ASCII: {asc}\n         HEX  : {d.hex(' ')}"
                print(blk); log.write(blk + "\n")
        if cmd:
            try: ser.write(b"E#"); ser.flush()
            except: pass
    finally:
        ser.close()
    if got:
        print(f"  ==> 데이터 {got}B 수신!"); log.write(f"  ==> {got}B\n")
    return got > 0


def main():
    with open(OUT, "w", encoding="utf-8") as log:
        log.write(f"HPM-300A 진단 v2 - {datetime.datetime.now()}\n")
        for baud in BAUDS:
            # A) 그냥 듣기
            if attempt(log, baud, True, True, b"", LISTEN_SEC, "듣기만"):
                return done(baud, "명령없이 스트리밍", log)
            # B/C) 명령 + DTR/RTS 조합
            for dtr, rts in DTR_RTS:
                for cmd in START_CMDS:
                    if attempt(log, baud, dtr, rts, cmd, CMD_SEC, "명령전송"):
                        return done(baud, f"DTR={dtr} RTS={rts} cmd={cmd!r}", log)
        msg = ("\n[!] 모든 조합에서 응답 없음.\n"
               "    다음을 확인하세요:\n"
               "    1) 장비 화면에 전압/전류 값이 실제로 표시되는 측정 상태인가\n"
               "    2) 장비에 'PC 통신' 모드/버튼이 있고 켜져 있는가 (통신 아이콘 점등)\n"
               "    3) 이 케이블이 AD Power 정품 데이터 케이블인가 (일반 FTDI 케이블은 배선이 다를 수 있음)\n"
               "    4) 배터리/전원이 충분한가")
        print(msg); log.write(msg + "\n")


def done(baud, how, log):
    m = f"\n[✓] 성공!  baud={baud}  설정: {how}\n    이 정보를 전달해 주세요."
    print(m); log.write(m + "\n")


if __name__ == "__main__":
    main()
