# GitHub Pages 데이터 공유 사용법

이 대시보드는 각 브라우저의 LocalStorage에 데이터를 저장합니다.
github.io 방문자에게도 내 실험/설계 기록을 보여주려면 **data.json**을 함께 배포하세요.

## 처음 배포할 때
1. 대시보드 상단 **저장 → 배포용 저장 (data.json)** 클릭 → `data.json` 다운로드
2. 다운로드한 `data.json`을 **index.html 과 같은 폴더**에 넣기
3. GitHub에 push (또는 웹에서 업로드)
4. `https<계정>.github.io/<저장소>/` 접속 → 방문자는 data.json을 자동으로 보게 됩니다

## 데이터를 갱신할 때
- 실험/설계를 더 한 뒤 다시 **배포용 저장 (data.json)** → 기존 data.json 교체 → push
- 이미 방문했던 사람은 접속 시 "새 배포 데이터가 있습니다" 안내가 뜨고, 수락하면 최신본으로 갱신됩니다

## 동작 규칙
- **첫 방문**(브라우저에 데이터 없음): data.json 자동 로드
- **재방문 + 더 최신 data.json**: 덮어쓸지 물어봄
- **data.json 없음 / 내 작업 PC**: 기존 LocalStorage 데이터를 그대로 사용 (자동 로드 안 함)

## 주의
- `file://` 로 직접 열면(그냥 더블클릭) 브라우저 보안상 data.json 자동 로드가 막힐 수 있습니다.
  github.io(http/https)에서는 정상 동작합니다.
- 방문자가 data.json 으로 본 데이터를 각자 수정하면 그건 그 사람 브라우저에만 저장됩니다(원본에 영향 없음).
