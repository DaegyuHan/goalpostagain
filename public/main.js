
function toggleMenu() {
    const sideMenu = document.querySelector('.side-menu');
    sideMenu.style.left = sideMenu.style.left === '0px' ? '-300px' : '0px';
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

