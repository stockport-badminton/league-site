// Moved out of views/admin/homepage-content-form.ejs (REARCH-07 step 5), unchanged.
var teaserQuill = new Quill('#teaser-editor', { theme: 'snow' });
var modalQuill = new Quill('#modal-editor', { theme: 'snow' });

document.querySelector('form').addEventListener('submit', function() {
  document.getElementById('teaser_html').value = teaserQuill.root.innerHTML;
  document.getElementById('modal_body_html').value = modalQuill.getText().trim().length ? modalQuill.root.innerHTML : '';
});
