// Moved out of views/generatedTournamentGallery.ejs (REARCH-07 step 5), unchanged.
// The gallery is fetched when the modal first opens, not with the page: its listing
// comes from Cloudinary and used to hold up the homepage's response (HARD-43, then
// Nov 2026). Bound on DOMContentLoaded because jQuery and Bootstrap load in the
// footer, after this.
document.addEventListener('DOMContentLoaded', function () {
  $('#generatedTournamentGalleryModal').one('show.bs.modal', function () {
    var carousel = document.getElementById('carouselExampleControls');
    var inner = carousel.querySelector('.carousel-inner');
    var status = inner.querySelector('[data-gallery-status]');
    fetch('/homepage-gallery')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        if (!/carousel-item/.test(html)) { status.textContent = 'No photos yet.'; return; }
        inner.innerHTML = html;
        $(carousel).carousel('cycle');
      })
      .catch(function () { status.textContent = 'The photos could not be loaded. Please try again later.'; });
  });
});
