// The club list's "get in touch" buttons, moved out of views/club-v2.ejs (REARCH-07
// step 5), unchanged.
$(document).ready(function(){
  $('.openForm').click(function(){
    var clubName = $(this).attr('data-club')
    var nameElem = this.parentNode.previousSibling.previousElementSibling.childNodes[0]
    if (nameElem.nodeType == 3){
      clubDesc = nameElem.textContent
    }
    else {
      clubDesc = nameElem.childNodes[0].textContent
    }
    $('#exampleModalLabel').html("Get in touch with " + clubDesc)
    $('#clubSelect').val(clubName)
  })
  // google.maps.event.addDomListener(window, 'load', initMap);
})
