function toggleMenu() {
    const sideMenu = document.querySelector('.side-menu');
    sideMenu.style.left = sideMenu.style.left === '0px' ? '-300px' : '0px';
  }
function gotoHome(){
  window.location.href = '/'
}
function gotoNotice(){
  window.history.back();
}

function gotoNotice_Home(){
  window.location.href = '/notice/1'
}