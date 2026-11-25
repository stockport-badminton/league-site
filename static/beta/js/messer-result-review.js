// Approve or reject a filed Messer result. Moved out of views/messer-result-detail.ejs
// (REARCH-07 step 5); the scorecard id is the Actions card's data-scorecard-id.
document.addEventListener('DOMContentLoaded', function() {
  const actions = document.querySelector('[data-scorecard-id]');
  const scorecardId = actions ? actions.dataset.scorecardId : '';

  document.getElementById('approveBtn').addEventListener('click', async function() {
    if (!confirm('Are you sure you want to approve this result? The messer table will be updated immediately.')) {
      return;
    }

    try {
      const response = await fetch(`/messer-result/${scorecardId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        alert('✓ Result approved and messer table updated!');
        window.location.href = '/messer-results';
      } else {
        alert('Error: ' + (data.error || 'Failed to approve result'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  document.getElementById('rejectBtn').addEventListener('click', async function() {
    if (!confirm('Are you sure you want to reject this result?')) {
      return;
    }

    try {
      const response = await fetch(`/messer-result/${scorecardId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        alert('✓ Result rejected. Captain will be notified.');
        window.location.href = '/messer-results';
      } else {
        alert('Error: ' + (data.error || 'Failed to reject result'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
});
