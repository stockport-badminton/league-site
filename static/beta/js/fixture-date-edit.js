// A superadmin's in-place edit of a fixture's date on the results page, moved out of
// views/fixtures-results.ejs (REARCH-07 step 5). The pencil icon is the page's
// #fdPencil <template>, rendered by icon() on the server.
var PENCIL = document.getElementById('fdPencil').innerHTML;


 $('a.js-rearrange-link').click(function(){
   $('#rearrangementModal > .formMessage').hide();
   $('#rearrangementForm > #date').show()
   $('#rearrangementForm > label').show()
   $('#fixtureRearange').show();
   $('#emailHelp').show()
   $('#rearrangementForm > #date')[0].value = "";
   $('#fixtureId')[0].value = $(this)[0]['attributes']['data-fixtureId'].value;
   $('#homeTeam')[0].value = $(this).parent().siblings()[1].textContent;
   $('#awayTeam')[0].value = $(this).parent().siblings()[2].textContent;
 })

 // Each open resets the popup completely — fields back, message gone, Send
 // enabled — and ignores a contacts answer that arrives after a different fixture
 // has been opened.
 var reminderRequest = 0;
 $('a.js-reminder-link').click(function(e){
   e.preventDefault();
   var link = $(this);
   var requestId = ++reminderRequest;
   $('#reminderFixtureId').val(link.attr('data-fixture-id'));
   $('#reminderFixture').text(link.attr('data-home-team') + ' v ' + link.attr('data-away-team'));
   $('#reminderRecipients').val('').prop('disabled', true).attr('placeholder', 'Looking up contacts…');
   $('#reminderContacts').empty();
   $('#reminderMessage').hide().removeClass('alert-success alert-danger alert-warning').text('');
   $('#reminderFields').show();
   $('#remindFixture').show().prop('disabled', true);

   $.getJSON('/fixture/' + encodeURIComponent(link.attr('data-fixture-id')) + '/reminder-contacts')
     .done(function (data) {
       if (requestId !== reminderRequest) return;
       var addresses = [];
       (data.contacts || []).forEach(function (c) {
         var item = $('<li>').text(c.role + ': ' + c.name + (c.email ? ' — ' + c.email : ' — no email on file'));
         $('#reminderContacts').append(item);
         if (c.email && addresses.indexOf(c.email) === -1) addresses.push(c.email);
       });
       if (!(data.contacts || []).length) {
         $('#reminderContacts').append($('<li>').text('Nobody is flagged as secretary, match secretary or captain for the home team.'));
       }
       $('#reminderRecipients').val(addresses.join(', '));
     })
     .fail(function () {
       if (requestId !== reminderRequest) return;
       $('#reminderMessage').addClass('alert-warning')
         .text('Could not look up the contacts — type the addresses in yourself.').show();
     })
     .always(function () {
       if (requestId !== reminderRequest) return;
       $('#reminderRecipients').prop('disabled', false).attr('placeholder', 'name@example.com, …');
       $('#remindFixture').prop('disabled', false);
     });
 })

/*  $('#fixtureRearange').click(function(){
   $.post('/fixture/rearrangement', {'date':$('#date')[0].value,'homeTeam':$('#homeTeam')[0].value,'awayTeam':$('#awayTeam')[0].value }, function (data) {
          console.log({'date':$('#date')[0].value,'homeTeam':$('#homeTeam')[0].value,'awayTeam':$('#awayTeam')[0].value });
          console.log(data);
          $('#rearrangementModal').html('<p>Fixture Updated!</p>');
          $('#fixtureRearange').remove();
       });
 }) */

 $('#fixtureRearange').click(function(){
   // The endpoint now answers JSON and can legitimately say no — an unmatched
   // team name or a pairing with no fixture this season. Reporting only success
   // meant a rejected request looked exactly like an accepted one.
   $.post('/fixture/rearrangement', {'date':$('#date')[0].value,'homeTeam':$('#homeTeam')[0].value,'awayTeam':$('#awayTeam')[0].value })
     .done(function (data) {
       var msg = data && data.action === 'rearranging'
         ? 'Fixture flagged as rearranging — no new date set.'
         : 'Fixture Updated!';
       $('#rearrangementModal > .formMessage').text(msg).show();
       $('#rearrangementForm > label').hide()
       $('#rearrangementForm > #date').hide()
       $('#emailHelp').hide()
       $('#fixtureRearange').hide();
     })
     .fail(function (xhr) {
       var err = (xhr.responseJSON && xhr.responseJSON.error) || 'Something went wrong — the fixture was not changed.';
       $('#rearrangementModal > .formMessage').text(err).show();
     });
 })

 $('#remindFixture').click(function(){
   var button = $(this).prop('disabled', true);
   $.post('/fixture/reminder', {
     fixtureId: $('#reminderFixtureId').val(),
     recipients: $('#reminderRecipients').val()
   })
     .done(function () {
       $('#reminderFields').hide();
       button.hide();
       $('#reminderMessage').removeClass('alert-danger alert-warning').addClass('alert-success')
         .text('Reminder sent to ' + $('#reminderRecipients').val() + '.').show();
     })
     .fail(function (xhr) {
       // Say why, and leave the form up so the address can be corrected.
       var err = (xhr.responseJSON && xhr.responseJSON.error) || 'Something went wrong — no reminder was sent.';
       $('#reminderMessage').removeClass('alert-success alert-warning').addClass('alert-danger').text(err).show();
       button.prop('disabled', false);
     });
 })

 // Conceding: POSTs to /admin/fixture/:id/concede and reloads, because the row's
 // class, result cell and actions all change with the status.
 function postConcede(id, concededBy) {
   return $.post('/admin/fixture/' + encodeURIComponent(id) + '/concede', { concededBy: concededBy })
     .done(function () { location.reload(); });
 }
 var concedeFixtureId = null;
 $('#results-table').on('click', '.concede-link', function (e) {
   e.preventDefault();
   concedeFixtureId = $(this).attr('data-fixture-id');
   // .text(), never .html(): team names go in as text.
   $('#concedeModal .concede-side[data-side="home"]').text($(this).attr('data-home') + ' conceded').prop('disabled', false);
   $('#concedeModal .concede-side[data-side="away"]').text($(this).attr('data-away') + ' conceded').prop('disabled', false);
   $('#concedeMessage').hide().text('');
   $('#concedeModal').modal('show');
 });
 $('#concedeModal .concede-side').on('click', function () {
   $('#concedeModal .concede-side').prop('disabled', true);
   postConcede(concedeFixtureId, $(this).attr('data-side'))
     .fail(function (xhr) {
       $('#concedeMessage').text((xhr.responseJSON && xhr.responseJSON.error) || 'Something went wrong — the fixture was not changed.').show();
       $('#concedeModal .concede-side').prop('disabled', false);
     });
 });
 $('#results-table').on('click', '.concede-undo-link', function (e) {
   e.preventDefault();
   if (!confirm('Undo this concession? The fixture goes back to outstanding with no score.')) return;
   postConcede($(this).attr('data-fixture-id'), 'none')
     .fail(function (xhr) {
       alert('Could not update the fixture: ' + ((xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText));
     });
 });

 // Inline fixture date edit (superadmin): edits the existing date in place.
 $('#results-table').on('click', '.fd-edit', function(e){
   e.preventDefault();
   var $cell = $(this).closest('.fixture-date');
   if ($cell.find('input.fd-input').length) return; // already editing
   $cell.data('prev', $cell.html());
   $cell.html(
     '<input type="date" class="fd-input" value="' + $cell.attr('data-iso') + '" style="width:150px;"> '
     + '<a href="#" class="fd-save" title="Save">✓</a> '
     + '<a href="#" class="fd-cancel" title="Cancel">✕</a> '
     + '<div class="fd-msg" style="color:#a5342b;font-size:12px;"></div>'
   );
   $cell.find('input.fd-input').focus();
 });
 $('#results-table').on('click', '.fd-cancel', function(e){
   e.preventDefault();
   var $cell = $(this).closest('.fixture-date');
   $cell.html($cell.data('prev'));
 });
 $('#results-table').on('click', '.fd-save', function(e){
   e.preventDefault();
   var $cell = $(this).closest('.fixture-date');
   var id = $cell.attr('data-fixture-id');
   var val = $cell.find('input.fd-input').val();
   if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) { $cell.find('.fd-msg').text('Pick a valid date'); return; }
   $cell.find('.fd-save, .fd-cancel').hide();
   $.ajax({ url: '/admin/fixture/' + id + '/date', method: 'POST', data: { date: val } })
     .done(function(){
       var p = val.split('-');
       $cell.attr('data-iso', val);
       $cell.html('<span class="fd-text">' + p[2] + '/' + p[1] + '/' + p[0] + '</span> '
         + '<a href="#" class="fd-edit" title="Edit date" aria-label="Edit date">' + PENCIL + '</a>');
     })
     .fail(function(xhr){
       $cell.find('.fd-msg').text((xhr.responseJSON && xhr.responseJSON.error) || 'Save failed');
       $cell.find('.fd-save, .fd-cancel').show();
     });
 });
 $('#results-table').on('keydown', 'input.fd-input', function(e){
   if (e.key === 'Enter') { e.preventDefault(); $(this).closest('.fixture-date').find('.fd-save').click(); }
   else if (e.key === 'Escape') { $(this).closest('.fixture-date').find('.fd-cancel').click(); }
 });
