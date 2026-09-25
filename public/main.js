
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    alert('이 브라우저에서는 웹 알림을 지원하지 않습니다.');
    return;
  }

  try {
    const keyResponse = await fetch('/push/public-key');
    const keyData = await keyResponse.json();
    if (!keyResponse.ok) throw new Error(keyData.message || '웹 푸시 설정이 필요합니다.');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('알림 권한이 허용되지 않았습니다.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
    });

    const subscribeResponse = await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
    const subscribeData = await subscribeResponse.json();
    if (!subscribeResponse.ok) throw new Error(subscribeData.message || '알림 설정에 실패했습니다.');

    alert('알림이 설정되었습니다. 사진 등록 알림을 받을 수 있습니다.');
  } catch (error) {
    console.error('Push subscription failed:', error);
    alert(error.message || '알림 설정에 실패했습니다.');
  }
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

