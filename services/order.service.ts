import { apiCall } from "./api";

export const OrderService = {
  placeOrder: async (
    restaurantId: string | number,
    tableId: string | number,
    sessionToken: string,
    items: { menu_item_id: number; quantity: number; notes: string | null }[],
    orderNote: string,
    idempotencyKey: string,
    paymentMethod: string = "pending", // 👈 ADDED THIS
  ) => {
    return apiCall(`/orders`, {
      method: "POST",
      headers: {
        "X-Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        restaurant_id: restaurantId,
        table_id: tableId,
        session_token: sessionToken,
        notes: orderNote || null,
        items: items,
        payment_method: paymentMethod, // 👈 ADDED THIS
      }),
    });
  },

  getOrders: async (sessionToken: string, signal?: AbortSignal) => {
    return apiCall(`/orders/session/${sessionToken}`, {
      method: "GET",
      signal: signal,
    });
  },

  cancelOrder: async (sessionToken: string, orderId: string | number) => {
    try {
      const response = await apiCall(`/orders/${orderId}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });
      return response;
    } catch (error: any) {
      throw new Error(error.message || "Failed to cancel order");
    }
  },
};
