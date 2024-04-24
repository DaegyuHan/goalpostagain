
function toggleMenu() {
    const sideMenu = document.querySelector('.side-menu');
    sideMenu.style.left = sideMenu.style.left === '0px' ? '-100%' : '0px';
  }
  
function gotoHome(){
  window.location.href = '/'
}

function gotoNotice(){
  window.location.href = '/notice/1'
}

function clearInput() {
  document.getElementById('search-input').value = '';

}

function gotoLogin(){
  window.location.href = '/login'
}

function gotoLogout(){
  window.location.href = '/logout'
  alert('로그아웃되었습니다.')
}


function gotoPhoto() {
  window.location.href = '/photo'
}

function gotoVideo() {
  window.location.href = '/video'
}

function gotoUpdate() {
  window.location.href = '/update-note'
}

function gotoNoticePost() {
  window.location.href = '/management/notice-post'
}

function gotoUpdatePost() {
  window.location.href = '/management/update-note-post'
}



function gotoMypage() {
  fetch('/user')
  .then(response => response.json())
  .then(data => {
    // 받은 데이터에서 유저 ID를 가져와서 변수에 저장
    const userId = data.userId;
    
    // 이후에 userId를 사용하여 필요한 작업을 수행
    window.location.href = '/mypage/' + userId;
  })
  .catch(error => console.error('Error fetching user data:', error));

}

