// Moved out of views/contact-us-form.ejs (REARCH-07 step 5), unchanged.
 function onSubmit(token) {
  // Submit the form after reCAPTCHA verification
  document.getElementById("contactUs").submit();
}

$(document).ready(function(){
  $('#contactType').change(function(){
    var shown = { Clubs: '#clubsDropDown', League: '#leagueDropDown', JuniorClub: '#juniorClubsDropDown' };
    var chosen = shown[$('#contactType').val()];
    $.each(shown, function(type, sel) {
      $(sel).attr('class', 'form-group ' + (sel === chosen ? 'd-block' : 'd-none'));
    });
  })
  $('.click').click(function(){
    console.log($(this).attr('data-club'))
  })
})
