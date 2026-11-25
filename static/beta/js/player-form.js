// Moved out of views/player_form.ejs (REARCH-07 step 5), unchanged. Choosing a club
// refills the team dropdown with that club's teams.
$(document).ready(function(){
  $("#club").change(function(){
    var selectedClub = this.value;
        $.post('/teams', {'clubid':selectedClub}, function (data) {
           // Generate the html from the given data.
           FormOptions.fillTeams($('#team'), data);
        });
  })

})
