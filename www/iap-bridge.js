(function () {
  function capacitor() {
    return window.Capacitor || null;
  }
  function nativePlugin() {
    var cap = capacitor();
    return cap && cap.Plugins && cap.Plugins.AllottedIAP ? cap.Plugins.AllottedIAP : null;
  }
  function isNative() {
    var cap = capacitor();
    return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  }
  function planFromProductId(productId) {
    if (productId === "allotted.premium.monthly") return "monthly";
    if (productId === "allotted.premium.yearly") return "yearly";
    return null;
  }
  function normalizeStatus(status) {
    status = status || {};
    var productId = status.productId || null;
    return {
      active: status.active === true,
      productId: productId,
      plan: status.plan || planFromProductId(productId),
      expiresAt: status.expiresAt || null,
      cancelled: status.cancelled === true,
      pending: status.pending === true
    };
  }
  function callNative(method, payload) {
    var plugin = nativePlugin();
    if (!plugin || typeof plugin[method] !== "function") {
      return Promise.reject(new Error("Native App Store purchases are unavailable in this build."));
    }
    return Promise.resolve(plugin[method](payload || {}));
  }

  if (!isNative() && !nativePlugin()) return;

  window.AllottedIAP = {
    purchase: function (productId) {
      return callNative("purchase", { productId: productId }).then(normalizeStatus);
    },
    restore: function () {
      return callNative("restore").then(normalizeStatus);
    },
    getStatus: function () {
      return callNative("getStatus").then(normalizeStatus);
    },
    getProducts: function () {
      return callNative("getProducts").then(function (result) {
        return result && Array.isArray(result.products) ? result.products : [];
      });
    }
  };
}());
