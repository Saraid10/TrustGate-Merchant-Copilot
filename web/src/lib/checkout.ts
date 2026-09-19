/**
 * The real checkout runs in an iframe inside the pay modal. Paytm's callback ends with a
 * redirect to /app, so the app loads again inside that iframe. That copy sends this message to
 * the parent instead of rendering, and the parent closes the modal and asks the server.
 */
export const CHECKOUT_RETURN = "trustgate:checkout-return";

export const inCheckoutFrame = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent: we are certainly framed
  }
};
