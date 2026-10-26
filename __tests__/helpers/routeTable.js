// Walks an Express 4 app's router stack and lists every route with its access declaration
// (REARCH-04). A route's declaration is the `.access` tag middleware/access.js puts on the
// route's FIRST middleware; anything else counts as undeclared, even if a gate follows.
//
// Routers mounted with app.use() are walked too. They are all mounted at '/' today, so a
// mounted router's paths are reported as written; a router mounted elsewhere would need its
// prefix recovered from the layer's regexp, and this throws rather than guess.

function routesOf(stack, out) {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        // One Route holds every method's layers when written router.route(p).get().post();
        // a layer from .all() has no method and applies to each.
        const handles = layer.route.stack
          .filter(l => l.method === undefined || l.method === method || method === '_all')
          .map(l => l.handle);
        const tags = handles.map(h => h.access).filter(Boolean);
        out.push({
          method: method.toUpperCase(),
          path: layer.route.path,
          access: handles[0] && handles[0].access || null,
          // A declaration that is not first, or more than one, is a mistake the walker
          // should surface rather than quietly accept.
          misplaced: tags.length > 0 && !(handles[0] && handles[0].access),
          declarations: tags.length,
        });
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      if (!layer.regexp.fast_slash) {
        throw new Error('routeTable: a router mounted somewhere other than "/" (' + layer.regexp + ')');
      }
      routesOf(layer.handle.stack, out);
    }
  }
  return out;
}

function routeTable(app) {
  return routesOf(app._router.stack, []).map((r, i) => ({ order: i + 1, ...r }));
}

module.exports = { routeTable };
