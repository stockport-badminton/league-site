// Moved out of views/admin/team-strength-compare.ejs (REARCH-07 step 5), unchanged.
document.getElementById('copy-case') && document.getElementById('copy-case').addEventListener('click', function () {
  var box = document.getElementById('case-text'), btn = this;
  box.select();
  var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(box.value).then(done, function () { document.execCommand('copy'); done(); });
  else { document.execCommand('copy'); done(); }
});
