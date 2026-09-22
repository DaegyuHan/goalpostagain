# 홈페이지 초기 로딩 개선 기록

작성일: 2026-09-23

## 개선 목표

운영환경에서 홈페이지 첫 로딩에 약 3초가 소요되는 원인을 줄이고, 첫 화면에 필요하지 않은 데이터와 외부 리소스의 초기 로딩 부담을 낮춘다.

## 주요 원인

홈페이지 라우트에서 MongoDB 조회 4개가 순차적으로 실행되고 있었다.

```js
await mvp 조회
await result 조회
await matchplan 조회
await mvpboard 조회
```

MongoDB Atlas와 서버 사이의 네트워크 왕복이 조회마다 발생하기 때문에 운영환경에서 응답 시간이 누적될 수 있었다.

추가로 홈페이지 템플릿에서 Google Fonts가 중복 선언되어 있었고, 첫 화면 아래쪽의 이미지도 초기 로딩 대상에 포함되어 있었다.

## 적용한 변경

### 1. MongoDB 조회 병렬화

파일: `server.js`

홈페이지 라우트의 네 가지 DB 조회를 `Promise.all()`로 동시에 실행하도록 변경했다.

기대 효과:

- DB 조회 간 대기 시간 중첩
- 순차 실행으로 누적되던 네트워크 지연 감소
- 홈페이지 서버 응답 시간 단축

### 2. 조회 데이터 양 축소

홈페이지에서 실제로 사용하는 범위만 조회하도록 변경했다.

- MVP: 최신 1개
- 경기 결과: 최신 3개
- 경기 일정: 최신 1개
- MVP 보드: 최신 1개

또한 MongoDB projection을 사용해 화면에 필요한 필드만 가져오도록 했다.

기대 효과:

- MongoDB 응답 데이터 크기 감소
- 서버 메모리 및 JSON 처리량 감소
- 문서 수가 늘어날수록 커지는 조회 비용 방지

### 3. 데이터가 없을 때 예외 방지

MVP 보드 데이터가 없을 경우 `undefined.member_score`에 접근하지 않고 빈 객체를 사용하도록 보완했다.

```js
const mvpboard = mvpboardResult.length > 0
  ? mvpboardResult[0].member_score
  : {};
```

### 4. Google Fonts 중복 요청 제거

파일: `views/home.ejs`

기존에 여러 개로 나뉘어 중복 선언된 Google Fonts 요청을 하나의 stylesheet 요청으로 통합했다.

통합한 폰트:

- Anton
- Gloock
- Hi Melody
- Noto Sans KR

기대 효과:

- 외부 stylesheet 요청 수 감소
- 폰트 로딩으로 인한 초기 렌더링 지연 감소

### 5. 하단 이미지 지연 로딩

파일: `views/home.ejs`

첫 화면 아래쪽에 있는 최근 경기 로고 이미지 3개에 다음 속성을 추가했다.

```html
loading="lazy"
```

기대 효과:

- 초기 화면에 보이지 않는 이미지의 요청 지연
- 첫 화면 로딩 시 네트워크 경쟁 감소
- 모바일 환경에서 데이터 사용량 감소

## 검증 결과

다음 검사를 통과했다.

```bash
node --check server.js
git diff --check -- server.js views/home.ejs
```

## 배포 후 확인할 항목

이번 작업은 코드 구조상 병목을 줄인 것이므로, 실제 개선 시간은 운영환경에서 측정해야 한다.

확인 권장 항목:

1. 배포 전후 홈페이지 첫 응답 시간
2. MongoDB 각 조회의 응답 시간
3. 브라우저 Network 탭의 문서 요청 완료 시간
4. Google Fonts 요청 수와 완료 시간
5. 모바일 환경의 First Contentful Paint와 Largest Contentful Paint

## 추가 개선 후보

현재도 초기 로딩이 3초 이상이면 다음 항목을 추가로 검토한다.

- MongoDB의 `_id` 정렬을 위한 인덱스 확인
- 정적 파일에 브라우저 캐시 기간 설정
- CSS 파일 통합 또는 사용하지 않는 CSS 제거
- 외부 이미지를 ImageKit의 자동 포맷 및 크기 변환 URL로 제공
- 서버 응답의 gzip 또는 Brotli 압축 적용
- 홈페이지 데이터의 짧은 시간 캐싱
