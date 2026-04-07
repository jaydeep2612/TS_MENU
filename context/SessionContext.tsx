import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import { SessionService } from "../services/session.service";

// --- TYPES ---
export type CartItem = {
  qty: number;
  price: number;
  name: string;
};

export type TableData = {
  rId: string;
  tId: string;
  token: string;
} | null;

type SessionContextType = {
  isReady: boolean;
  tableData: TableData;
  setTableData: (data: TableData) => void;
  sessionToken: string | null;
  customerName: string;
  joinStatus: string | null;
  setJoinStatus: (status: string | null) => void;
  isPrimary: boolean;
  cart: Record<number, CartItem>;
  setCustomerName: (name: string) => void;
  startSession: (name: string, mode: "new" | "join") => Promise<void>;
  clearSession: () => Promise<void>;
  updateCart: (
    id: number,
    delta: number,
    price?: number,
    name?: string,
  ) => void;
  clearCart: () => void;
  cartTotalQty: number;
  cartTotalPrice: number;
  menuData: any;
  setMenuData: (data: any) => void;
  orders: any[];
  setOrders: React.Dispatch<React.SetStateAction<any[]>>;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // --- STATE ---
  const [isReady, setIsReady] = useState(false); // Hydration guard
  const [tableData, setTableData] = useState<TableData>(null); // QR URL Params
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [isPrimary, setIsPrimary] = useState(false); // Host vs Guest
  const [cart, setCart] = useState<Record<number, CartItem>>({});
  const [menuData, setMenuData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);

  // --- 1. LOAD PERSISTED STATE ON MOUNT ---
  useEffect(() => {
    const loadStoredSession = async () => {
      try {
        const storedTable = await AsyncStorage.getItem("tableData");
        const token = await AsyncStorage.getItem("sessionToken");
        const name = await AsyncStorage.getItem("customerName");
        const storedCart = await AsyncStorage.getItem("cart");
        const primary = await AsyncStorage.getItem("isPrimary");
        const status = await AsyncStorage.getItem("joinStatus");
        const storedOrders = await AsyncStorage.getItem("orders"); // 🔥 NEW

        if (storedTable) setTableData(JSON.parse(storedTable));
        if (token) setSessionToken(token);
        if (name) setCustomerName(name);
        if (storedCart) setCart(JSON.parse(storedCart));
        if (primary) setIsPrimary(primary === "true");
        if (status) setJoinStatus(status);
        if (storedOrders) setOrders(JSON.parse(storedOrders)); // 🔥 NEW
      } catch (e) {
        console.error("Failed to load session from storage", e);
      } finally {
        setIsReady(true); // Hydration is complete, safe to render app
      }
    };
    loadStoredSession();
  }, []);

  // --- 2. PERSIST STATE CHANGES (AUTOSAVE) ---
  useEffect(() => {
    if (!isReady) return;

    if (tableData) AsyncStorage.setItem("tableData", JSON.stringify(tableData));
    if (sessionToken) AsyncStorage.setItem("sessionToken", sessionToken);
    AsyncStorage.setItem("customerName", customerName);
    AsyncStorage.setItem("cart", JSON.stringify(cart));
    AsyncStorage.setItem("orders", JSON.stringify(orders)); // 🔥 NEW
    AsyncStorage.setItem("isPrimary", isPrimary ? "true" : "false");

    // Actively remove ghost state if status becomes null
    if (joinStatus) {
      AsyncStorage.setItem("joinStatus", joinStatus);
    } else {
      AsyncStorage.removeItem("joinStatus");
    }
  }, [
    tableData,
    sessionToken,
    customerName,
    cart,
    isPrimary,
    joinStatus,
    isReady,
    orders, // 🔥 THIS IS THE DEPENDENCY ARRAY FIX! We added 'orders' here.
  ]);

  // --- 3. OPTIMIZED CART LOGIC ---
  const updateCart = (
    id: number,
    delta: number,
    price: number = 0,
    name: string = "",
  ) => {
    setCart((prev) => {
      // Safety check: Prevent decreasing an item that isn't in the cart
      if (!prev[id] && delta < 0) return prev;

      const currentItem = prev[id] || { qty: 0, price, name };
      const newQty = currentItem.qty + delta;

      // If quantity hits 0, remove it from the cart object
      if (newQty <= 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: { ...currentItem, qty: newQty } };
    });
  };

  const clearCart = () => setCart({});

  // Calculate Totals using useMemo (O(N) operation on cart items only)
  const { cartTotalQty, cartTotalPrice } = useMemo(() => {
    let qty = 0;
    let price = 0;
    Object.values(cart).forEach((item) => {
      qty += item.qty;
      price += item.qty * item.price;
    });
    return { cartTotalQty: qty, cartTotalPrice: price };
  }, [cart]);

  // --- 4. API ACTIONS ---
  const startSession = async (name: string, mode: "new" | "join") => {
    try {
      if (!tableData) {
        throw new Error(
          "Missing table QR data. Please scan the QR code again.",
        );
      }

      const data: any = await SessionService.startSession(
        name,
        mode,
        tableData.rId,
        tableData.tId,
        tableData.token,
      );

      setCustomerName(data.customer_name || name);
      setSessionToken(data.session_token);
      setJoinStatus(data.join_status);
      setIsPrimary(data.is_primary || false);
    } catch (e: any) {
      console.error("Session start failed", e);

      const errorMessage = e.message || "Failed to start session.";
      if (Platform.OS === "web") {
        window.alert(`Error: ${errorMessage}`);
      } else {
        Alert.alert("Session Error", errorMessage);
      }

      throw e;
    }
  };

  const clearSession = async () => {
    try {
      if (sessionToken) {
        await SessionService.leaveSession(sessionToken);
      }
    } catch (e) {
      console.error("Failed to notify server of leave", e);
    } finally {
      await AsyncStorage.multiRemove([
        "sessionToken",
        "customerName",
        "cart",
        "isPrimary",
        "joinStatus",
        "tableData",
        "orders", // 🔥 Ensure orders clear when they leave the table
      ]);

      // Reset all state to completely blank
      setSessionToken(null);
      setCustomerName("");
      setCart({});
      setIsPrimary(false);
      setJoinStatus(null);
      setOrders([]);
      setTableData(null);
    }
  };

  return (
    <SessionContext.Provider
      value={{
        isReady,
        tableData,
        setTableData,
        sessionToken,
        customerName,
        joinStatus,
        setJoinStatus,
        isPrimary,
        cart,
        setCustomerName,
        startSession,
        clearSession,
        updateCart,
        clearCart,
        cartTotalQty,
        cartTotalPrice,
        menuData,
        setMenuData,
        orders,
        setOrders,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context)
    throw new Error("useSession must be used within a SessionProvider");
  return context;
};
