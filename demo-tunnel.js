/* No-database mode for the online prototype.
   The demo data lives in this browser (localStorage). Every /api/ call is sent to the server
   together with that data; the server runs the normal rules on it and sends the updated copy back.
   So logins and outpasses survive even though Vercel's servers keep nothing between requests.
   Different browsers/devices each have their own copy of the demo. */
(function () {
  if (!window.OUTPASS_TUNNEL) return;
  var STATE = 'cvv_outpass_demo_state_v1', SESSION = 'cvv_outpass_demo_session_v1';
  var realFetch = window.fetch.bind(window);
  var queue = Promise.resolve();

  function load(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  window.resetOutpassDemo = function () {
    try { localStorage.removeItem(STATE); localStorage.removeItem(SESSION); } catch (e) {}
    location.href = '/';
  };

  window.fetch = function (input, init) {
    init = init || {};
    var url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || url.pathname.indexOf('/api/') !== 0) return realFetch(input, init);

    var send = function () {
      var headers = init.headers || {};
      var envelope = {
        method: (init.method || 'GET').toUpperCase(),
        path: url.pathname + url.search,
        body: init.body === undefined ? null : init.body,
        contentType: headers['Content-Type'] || headers['content-type'] || null,
        state: load(STATE, null),
        session: JSON.parse(load(SESSION, '{}')),
      };
      return realFetch('/api/__tunnel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope),
      }).then(function (r) { return r.json(); }).then(function (out) {
        save(STATE, out.state);
        save(SESSION, JSON.stringify(out.session || {}));
        return new Response(out.body, { status: out.status, headers: { 'Content-Type': out.contentType || 'application/json' } });
      });
    };
    // One request at a time per tab, so each one starts from the latest saved data.
    var p = queue.then(send, send);
    queue = p.catch(function () {});
    return p;
  };
})();
