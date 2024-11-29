![logo(180)](https://github.com/user-attachments/assets/c6544a9b-d0fc-4a81-8c3c-0f034e86fec2)
# 오늘도골대FC 홈페이지
### 🔗 서비스 링크
https://www.goalpostagian.com
### 🔗 개발 일지
https://hanstory33.tistory.com/category/Project/%EC%B6%95%EA%B5%AC%EB%AA%A8%EC%9E%84%20%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80%EA%B0%9C%EB%B0%9C
### ⏲ 개발 기간
> 기간 2023.10.31 ~ 평생

### 👥 개발 인원
> 디자이너 2인, 프론트/서버 개발 1인 (본인)

### 사용 기술
![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![EJS](https://img.shields.io/badge/ejs-%23B4CA65.svg?style=for-the-badge&logo=ejs&logoColor=black)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white)
![jQuery](https://img.shields.io/badge/jquery-%230769AD.svg?style=for-the-badge&logo=jquery&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-%23FF9900.svg?style=for-the-badge&logo=amazon-aws&logoColor=white)
![Amazon S3](https://img.shields.io/badge/Amazon%20S3-FF9900?style=for-the-badge&logo=amazons3&logoColor=white)
![Visual Studio](https://img.shields.io/badge/Visual%20Studio-5C2D91.svg?style=for-the-badge&logo=visual-studio&logoColor=white)
---

## 💡 프로젝트 소개
7년 째 매주 금요일마다 풋살을 하는데, 저희 팀원들끼리의 소통과 운영 그리고 추억을 기록하기 위한 관리 홈페이지 입니다.

## 💡 주요 기능
### ⚽ 모바일 지원
![image](https://github.com/user-attachments/assets/3b5b8f58-bf58-467f-a1bf-b70066390733)

![image](https://github.com/user-attachments/assets/4db05d54-295e-4a3b-bb84-cf8b8d048036)

- 반응형 웹 디자인을 통해 다양한 모바일 기기에서도 서비스 지원


### ⚽ 경기 일정

![image](https://github.com/user-attachments/assets/9973b287-ee1d-4f59-969c-3b369ba7d9d9)
  
- 사용자는 이번 주 경기 일정 확인 가능
- 네이버 지도 연결을 통해 경기장 위치 확인 가능

### ⚽ 경기 결과
- 사용자는 이전 경기 전적 확인 가능

![image](https://github.com/user-attachments/assets/a6ef9b6e-684a-4006-9a29-f4b021bdf115)

- 경기 결과 아이콘에 마우스 hover 시에 투표를 통해 결정된 해당 경기 MVP 확인 가능

### ⚽ MVP 대시보드
- 경기 참여, 매 경기 MVP 투표로 점수를 부여
- 상반기/하반기로 나누어 워크샵 때 5등까지 상품 수여 ( 풋살화, 헤어밴드 등 )
  
### ⚽ 팀 소개
- 선수 명단
### ⚽ 선수 스탯창

![image](https://github.com/user-attachments/assets/bac4629e-01a8-46db-ad57-09b8387146d6)

- 선수 개인적인 특성 및 다른 팀원들이 부여한 나의 세부 스탯 평균 수치 자동 업데이트
  
### ⚽ 사진&영상 앨범
- 사진앨범
  - S3 연결을 통해 사진 데이터 보관 및 관리
  - 다수의 이미지 업로드 및 확인 가능
  - 댓글
- 영상앨범
  - youtube 에 업로드된 링크를 입력하면 url 을 분석해서 영상을 가져오는 방식
### ⚽ 공지사항
- 개발자 업데이트 공지사항 구현
- 운영진 이벤트 공지사항 구현
### ⚽ 승부차기 미니게임
- 하루 20회 제한
  - 기존 로그인한 날짜와 현재 로그인한 날짜가 다르면 횟수 초기화
- 최고기록 갱신 시 DB 에 기록 업데이트 및 자동 순위 책정
- 매 달 1일 초기화 및 1,2위 상품 수여

---
## 💡 업데이트 내역
🔗 [개발자 업데이트 노트](http://www.goalpostagain.com/update-note)
<details>
  <summary>2024.06.29 v1.2.2</summary>
  
- 선수 스탯창
  - 오늘부터 선수 스탯창이 공개됩니다. 그 동안 인원별로 부여해주신 점수들의 평균값으로 나타납니다.
  - 각 항목별 오버롤과 특성 또한 볼 수 있습니다.
  - 점수 부여는 언제든지 할 수 있습니다.

- 비디오 탭
  - 비디오 탭에 더보기 버튼이 생겼습니다. 업로드 된 비디오 수가 많아지면서 로딩 속도를 상승시키기 위해 처음에는 3개의 동영상만 로딩됩니다.

- 운영관리 탭
  - 운영관리 탭에서 석범수(5) 의 각 인원별 특성 지정 권한, 공지사항 작성 권한이 생겼습니다.
  - 일부 사용자에게 오늘도골대 평균 오버롤을 확인할 수 있는 기능이 추가되었습니다.

- 오류 수정
  - 비디오 탭에서 모바일 환경에서 유튜브 URL 등록이 안 되던 오류가 수정되었습니다.
  - 경기결과 탭에서 년도가 입력이 안 되던 오류가 수정되었습니다.

</details>
<details>
  <summary>2024.06.13 v1.2.1</summary>
  
- 오연택(2), 유성진(96), 황덕현(99) 프로필 사진
  - 팀소개 탭에 오연택, 유성진 , 황덕현 프로필 사진이 추가되었어요. 그에 따라 MVP 프로필 사진도 업데이트 되었습니다.
- 선수 스탯창 점수 부여
  - 오늘부로 선수 스탯창 점수 부여 기간이 시작되었어요. 로그인 후 팀소개 탭의 프로필사진들을 누르면 상단에 스탯부여하기 버튼을 눌러 점수를 입력하고, 아래의 저장 버튼을 누르면 점수 부여가 완료됩니다. 점수는 추후에 공개될 예정이에요.
- 승부차기 탭
  - 승부차기 탭 게임 설명 칸의 문구가 변경되었어요. 상품은 고정이 아니고 매 달 운영진이 결정해서 따로 공지할 예정이에요.
</details>
<details>
  <summary>2024.05.12 v1.1.6</summary>
  
- New face 황덕현 (No.99)
  - 황덕현이 새로 가입되면서 팀소개 탭에 새로운 포지션 GOLLEIRO 항목이 추가되었어요. MVP 프로필, 사진탭 프로필 사진이 99번으로 추가되었어요. 빠른 시일 내에 촬영이 있을 예정이에요.
- 박승룡(1), 민대식(11) 프로필 사진
  - 박승룡, 민대식 촬영 사진이 업데이트가 되었어요. 팀소개 탭의 프로필과 MVP 프로필 모두 촬영된 사진으로 수정되었어요.
- 운영관리/경기결과 탭
  - 매치 일정, 매치 결과 기록 탭에 년도 입력 칸이 생겼어요. 곧 하반기로 들어서면서 25년을 대비하기 위함입니다. 그에 따라 경기결과 탭에서도 "24년" 고정이 아니라 입력된 년도로 유동적으로 표기됩니다.
- 오류 수정
  - 회원가입 완료 시 에러 메세지가 나오던 오류 수정
  - 회원가입 완료 시 " 회원가입이 완료되었습니다. " 알림 추가
  - 로그인 만료 후 영상 탭 접근 시 에러 메세지가 나오던 오류 수정
 
</details>
<details>
  <summary>2024.05.04 v1.1.5</summary>
  
- 승부차기 게임
  -4월 이벤트가 종료되면서 원래의 기본 보상으로 변경되었어요. 승부차기 탭의 게임 설명을 확인해주세요.
- 로그인
  - 기존에 회원 권한이 필요한 페이지로 접근 후 로그인 성공 시 홈 화면으로 이동하던 상황이 수정되었어요.
  - 이제는 로그인 성공 시 본인이 접근하려 했던 페이지로 자동 이동됩니다.
  - ex )
    - 기존 [ 승부차기 탭 접근 → 로그인 화면 → 홈 화면 → 승부차기 탭 ]
    - 변경 [ 승부차기 탭 접근 → 로그인 화면  → 승부차기 탭 ]

- 사용자 편의 기능
 로그인 유지 시간이 기존 4시간에서 8시간으로 변경되었어요. 
</details>
<details>
  <summary>2024.04.24 v1.1.4</summary>
  
- 경기결과 탭
  - WIN/DRAW/LOSE 이미지를 클릭 또는 마우스를 올려놓으면 해당 경기의  MVP 주인공이 누군지 알 수 있게 되었습니다.
  - 경기결과 입력값, 수치가 조금 더 정돈되게 정리되었습니다.
</details>
<details>
  <summary>2024.04.07 v1.1.3</summary>
  
- 업데이트 공지 탭
  - 공지사항 목록 상단에 있는 업데이트 공지 탭을 통해 업데이트 내용을 볼 수 있게 됩니다.
- 운영관리 탭
  - 운영관리 탭 UI 가 개선되었습니다.
- 오류수정
  - 아이폰 미니12 에서 공지사항 상세페이지 댓글 작성 버튼의 글씨가 잘려 나오는 오류가 수정되었습니다.
</details>
<details>
  <summary>2024.03.28 v1.1.2</summary>
  
- 승부차기 게임
  - 승부차기 게임 하루 제한 횟수가 20회로 제한되었습니다.
  - 매일 자정 자동 초기화 됩니다.
  - 4월 승부차기 1,2위 회비할인 이벤트가 시작되었습니다.
- 공지사항
  - 공지사항 게시물 제목 옆에 해당 게시물 댓글 수를 미리 확인할 수 있게 되었습니다.
</details>
<details>
  <summary>2024.02.28 v1.1.1</summary>
  오늘도골대FC 홈페이지 정식 출시
</details>
