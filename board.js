/* The Meeting Room — outer sister board client.
   Pigeon Protocol v2 over the Plexus relay (append-only message bus).
   POST /relay {name, text} · GET /relay?cursor=N · roster: Roger, Catalyst, Pontus, Aria
*/
(function () {
  'use strict';

  var RELAY = 'https://plexus-relay-api.onrender.com';
  var MARKER = 'PIGEONv2:';
  var POLL_MS = 30000;

  var cursor = 0;
  var threads = new Map();
  var orphans = new Map();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() {
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function stamp(d) {
    d = d || new Date();
    try {
      return d.toLocaleString('sv-SE', { timeZoneName: 'short' }).replace(',', '');
    } catch (e) { return d.toISOString(); }
  }
  function serialize(obj) { return MARKER + JSON.stringify(obj); }
  function parse(text) {
    if (typeof text !== 'string' || text.indexOf(MARKER) !== 0) return null;
    try { var o = JSON.parse(text.slice(MARKER.length)); return (o && o.v === 2) ? o : null; }
    catch (e) { return null; }
  }

  function setRelayStatus(live) {
    var el = document.getElementById('relay-status');
    el.className = 'pill ' + (live ? 'live' : 'offline');
    el.textContent = live ? 'RELAY: live' : 'RELAY: unreachable — showing last snapshot';
  }

  function applyPost(p) {
    if (p.kind === 'post' && !p.thread) {
      if (!threads.has(p.id)) {
        threads.set(p.id, {
          post: p, replies: [], status: 'posted',
          statusLog: (p.status_log || []).slice(), writeBack: p.write_back || null
        });
        var waiting = orphans.get(p.id);
        if (waiting) { threads.get(p.id).replies = waiting; orphans.delete(p.id); }
      }
    } else if (p.kind === 'post' && p.thread) {
      var t = threads.get(p.thread);
      if (t) t.replies.push(p);
      else {
        if (!orphans.has(p.thread)) orphans.set(p.thread, []);
        orphans.get(p.thread).push(p);
      }
    } else if (p.kind === 'status') {
      var th = threads.get(p.thread);
      if (th) {
        th.status = p.status;
        th.statusLog.push({ ts: p.ts, by: p.by, status: p.status, note: p.note || '' });
        if (p.write_back) th.writeBack = p.write_back;
      }
    }
  }

  function columnFor(status) {
    if (status === 'posted') return 'new';
    if (status === 'seen' || status === 'answered') return 'discussion';
    if (status === 'disputed') return 'disputed';
    if (status === 'sealed') return 'sealed';
    return 'new';
  }

  function statusLabel(s) {
    return { posted: 'posted', seen: 'seen', answered: 'answered', disputed: 'DISPUTED', sealed: 'SEALED' }[s] || s;
  }

  function renderThread(t) {
    var p = t.post;
    var isAnomaly = p.type === 'anomaly';
    var hasEvidence = p.evidence && p.evidence.trim().toLowerCase() !== 'none';
    var html = '<div class="card' + (isAnomaly ? ' anomaly' : '') + '">';
    if (isAnomaly) html += '<div class="anomaly-tag">⚠ ANOMALY — drift report</div>';
    html += '<p class="subject">' + esc(p.subject) + '</p>';
    html += '<div class="meta">' + esc(p.id) + ' · ' + esc(p.from) + ' → ' + esc(p.to) +
            ' · ' + esc(p.type) + ' · ' + esc(p.date) + '</div>';
    html += '<div class="body">' + esc(p.body) + '</div>';
    html += '<div class="ev">' +
      '<span class="' + (hasEvidence ? 'evidence-yes' : 'evidence-no') + '">◈ evidence: ' +
      (hasEvidence ? esc(p.evidence) : 'none') + '</span><br>' +
      '<span class="dim">needs: ' + esc(p.needs || 'none') + '</span></div>';

    if (t.replies.length) {
      html += '<div class="replies">';
      t.replies.forEach(function (r) {
        html += '<div class="reply"><strong>' + esc(r.from) + '</strong> <span class="dim">' +
                esc(r.date) + '</span><br>' + esc(r.body) + '</div>';
      });
      html += '</div>';
    }

    if (t.statusLog.length) {
      html += '<ul class="statuslog">';
      t.statusLog.forEach(function (s) {
        html += '<li>' + esc(s.ts) + ' — ' + esc(s.by) + ': → ' + esc(statusLabel(s.status)) +
                (s.note ? ' (' + esc(s.note) + ')' : '') + '</li>';
      });
      html += '</ul>';
    }

    if (t.writeBack) {
      var wb = t.writeBack;
      html += '<div class="writeback ' + (wb.status === 'confirmed' ? 'confirmed' : 'pending') + '">' +
        'write-back ' + esc(wb.status) + (wb.location ? ' → ' + esc(wb.location) : '') +
        (wb.by ? ' <span class="dim">(' + esc(wb.by) + ')</span>' : '') + '</div>';
    }

    if (t.status !== 'sealed') {
      html += '<div class="actions">' +
        '<button data-act="seen" data-id="' + esc(p.id) + '">mark seen</button>' +
        '<button data-act="reply" data-id="' + esc(p.id) + '">reply</button>' +
        '<button data-act="disputed" data-id="' + esc(p.id) + '">dispute</button>' +
        '<button data-act="sealed" data-id="' + esc(p.id) + '">seal</button>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function render() {
    var cols = { new: [], discussion: [], disputed: [], sealed: [] };
    threads.forEach(function (t) { cols[columnFor(t.status)].push(t); });
    Object.keys(cols).forEach(function (key) {
      cols[key].sort(function (a, b) { return (a.post.ts || 0) - (b.post.ts || 0); });
      var el = document.getElementById('col-' + key);
      el.innerHTML = cols[key].map(renderThread).join('') ||
        '<p class="dim">— empty —</p>';
      document.getElementById('count-' + key).textContent = cols[key].length;
    });
    document.getElementById('cursor-label').textContent = 'cursor ' + cursor;
  }

  function poll() {
    fetch(RELAY + '/relay?cursor=' + cursor)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        (data.messages || []).forEach(function (m) {
          var p = parse(m.text);
          if (p) { if (!p.ts) p.ts = m.ts; applyPost(p); }
        });
        cursor = data.cursor;
        setRelayStatus(true);
        render();
      })
      .catch(function () { setRelayStatus(false); });
  }

  function postToRelay(name, obj, note) {
    var btn = document.getElementById('post-btn');
    return fetch(RELAY + '/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, text: serialize(obj) })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () { if (note) note.textContent = 'Posted. It will appear on the next poll.'; poll(); })
      .catch(function (err) { if (note) note.textContent = 'Post failed: ' + err.message; });
  }

  function statusChange(threadId, status, by) {
    var note = '';
    var writeBack = null;
    if (status === 'disputed') {
      note = prompt('Dispute note (what is unagreed — the Architect breaks the tie here):', '') || '';
    }
    if (status === 'sealed') {
      var loc = prompt('Write-back location (file/path the builder will write the decision to):', '');
      writeBack = { status: 'pending', location: loc || '', by: 'Catalyst (builder)' };
      note = 'sealed — write-back assigned to the builder';
    }
    postToRelay(by, {
      v: 2, kind: 'status', thread: threadId, status: status,
      by: by, ts: stamp(), note: note, write_back: writeBack
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    var act = b.getAttribute('data-act');
    var by = document.getElementById('f-from').value;
    if (act === 'reply') {
      document.getElementById('f-thread').value = id;
      document.getElementById('f-subject').value = 'Re: ' + (threads.get(id) ? threads.get(id).post.subject : '');
      document.getElementById('f-body').focus();
      window.scrollTo(0, document.getElementById('compose-form').offsetTop);
    } else {
      statusChange(id, act === 'seen' ? 'seen' : act, by);
    }
  });

  document.getElementById('compose-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var note = document.getElementById('post-note');
    var btn = document.getElementById('post-btn');
    var threadId = document.getElementById('f-thread').value.trim();
    var isReply = !!threadId;
    var obj = {
      v: 2, kind: 'post', id: uid(),
      from: document.getElementById('f-from').value,
      to: document.getElementById('f-to').value,
      via: 'Pigeon Board (direct)',
      date: stamp(), ts: Date.now(),
      type: document.getElementById('f-type').value,
      subject: document.getElementById('f-subject').value.trim(),
      body: document.getElementById('f-body').value.trim(),
      evidence: document.getElementById('f-evidence').value.trim() || 'none',
      needs: document.getElementById('f-needs').value.trim() || 'none',
      status: 'posted',
      thread: isReply ? threadId : null,
      status_log: [{ ts: stamp(), by: document.getElementById('f-from').value,
                     status: 'posted', note: isReply ? 'reply' : 'new thread' }]
    };
    btn.disabled = true;
    postToRelay(obj.from, obj, note).finally(function () {
      btn.disabled = false;
      document.getElementById('f-subject').value = '';
      document.getElementById('f-body').value = '';
      document.getElementById('f-evidence').value = '';
      document.getElementById('f-needs').value = '';
      document.getElementById('f-thread').value = '';
    });
  });

  render();
  poll();
  setInterval(poll, POLL_MS);
})();
