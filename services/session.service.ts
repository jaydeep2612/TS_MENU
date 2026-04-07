import { apiCall } from "./api"; // 🔥 FIX: Import authHeaders

export const SessionService = {
  validateTable: async (rId: string, tId: string, token: string) => {
    return apiCall(`/qr/validate/${rId}/${tId}/${token}`);
  },

  startSession: async (
    name: string,
    mode: "new" | "join",
    rId: string,
    tId: string,
    token: string,
  ) => {
    return apiCall(`/qr/session/start/${rId}/${tId}/${token}`, {
      method: "POST",
      body: JSON.stringify({ customer_name: name, mode }),
    });
  },

  fetchMenu: async (
    rId: string,
    tId: string,
    token: string,
    sessionToken: string,
  ) => {
    return apiCall(
      `/menu/${rId}/${tId}/${token}?session_token=${sessionToken}`,
    );
  },

  checkSessionStatus: async (
    rId: string,
    tId: string,
    token: string,
    sessionToken: string,
  ) => {
    return apiCall(
      `/menu/${rId}/${tId}/${token}?session_token=${sessionToken}`,
    );
  },

  leaveSession: async (sessionToken: string) => {
    return apiCall(`/qr/session/leave`, {
      method: "POST",
      body: JSON.stringify({ session_token: sessionToken }),
    });
  },

  getPendingRequests: async (tableId: string, sessionToken: string) => {
    return apiCall(
      `/table/${tableId}/pending-requests?session_token=${sessionToken}`,
    );
  },

  respondToRequest: async (
    sessionId: number,
    action: "approve" | "reject",
    sessionToken: string,
  ) => {
    return apiCall(`/session/${sessionId}/respond`, {
      method: "POST",
      body: JSON.stringify({ action, session_token: sessionToken }),
    });
  },

  // 🔥 NEW & CRITICAL: Added the missing callWaiter method!
  callWaiter: async (sessionToken: string) => {
    return apiCall(`/session/call-waiter`, {
      method: "POST",
      // 👇 FIX: Send token in the body instead of relying on headers
      body: JSON.stringify({ session_token: sessionToken }),
    });
  },
  requestBill: async (sessionToken: string) => {
    return apiCall(`/session/request-bill`, {
      method: "POST",
      body: JSON.stringify({ session_token: sessionToken }),
    });
  },
  // Add this inside SessionService
  // 👇 Update the signature to accept "pending"
  selectPaymentMethod: async (
    sessionToken: string,
    method: "cash" | "upi" | "pending",
  ) => {
    return apiCall(`/session/select-payment-method`, {
      method: "POST",
      body: JSON.stringify({ session_token: sessionToken, method }),
    });
  },
};
