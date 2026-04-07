import { apiCall } from "./api";

export const OrderService = {
  placeOrder: async (
    restaurantId: string | number,
    tableId: string | number,
    sessionToken: string,
    items: { menu_item_id: number; quantity: number; notes: string | null }[],
    orderNote: string,
    idempotencyKey: string,
  ) => {
    // 1. Point to the base /orders endpoint
    return apiCall(`/orders`, {
      method: "POST",
      headers: {
        "X-Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
      },
      // 2. Put the IDs and Token in the body just like your old code
      body: JSON.stringify({
        restaurant_id: restaurantId,
        table_id: tableId,
        session_token: sessionToken,
        notes: orderNote || null,
        items: items,
      }),
    });
  },
  // Add 'signal?: AbortSignal' to the parameters, and pass it in the options
  getOrders: async (sessionToken: string, signal?: AbortSignal) => {
    return apiCall(`/orders/session/${sessionToken}`, {
      method: "GET",
      signal: signal,
    });
  },
};
