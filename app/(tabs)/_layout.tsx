import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { THEME } from "../../constants/theme";
import { useSession } from "../../context/SessionContext";

// 🔥 GLOBAL NOTIFIER: Ye track karega ki Bill tab kab dikhana hai
export const billTabNotifier = {
  listeners: new Set<Function>(),
  isVisible: false,
  show() {
    this.isVisible = true;
    this.listeners.forEach((l) => l(true));
  },
  subscribe(listener: Function) {
    this.listeners.add(listener);
    listener(this.isVisible);
    return () => this.listeners.delete(listener);
  },
};

export default function TabLayout() {
  const { sessionToken, isReady, cartTotalQty } = useSession();
  const [showBillTab, setShowBillTab] = useState(billTabNotifier.isVisible);

  useEffect(() => {
    const unsubscribe = billTabNotifier.subscribe(setShowBillTab);
    return () => unsubscribe();
  }, []);

  if (!isReady) {
    return null;
  }

  if (!sessionToken) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: THEME.primary,
        tabBarInactiveTintColor: THEME.textSecondary,
        headerShown: false,
        tabBarStyle: {
          height: Platform.OS === "ios" ? 85 : 65,
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
          paddingTop: 10,
          backgroundColor: "#FFFFFF",
          borderTopWidth: 1,
          borderTopColor: THEME.border || "#E2E8F0",
          ...Platform.select({
            ios: {
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.05,
              shadowRadius: 8,
            },
            android: {
              elevation: 8,
            },
          }),
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="menu-book" size={24} color={color} />
          ),
        }}
      />
      
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color }) => (
            <Ionicons name="cart" size={24} color={color} />
          ),
          tabBarBadge: (cartTotalQty || 0) > 0 ? cartTotalQty : undefined,
          tabBarBadgeStyle: { 
            backgroundColor: THEME.primary, 
            color: '#fff', 
            fontSize: 10,
            minWidth: 16,
            height: 16,
            lineHeight: 16,
          },
        }}
      />

      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="receipt-long" size={24} color={color} />
          ),
        }}
      />

      {/* 👇 FIX: Safe Tab Hiding (Display none) to prevent crash 👇 */}
      <Tabs.Screen
        name="bills"
        options={{
          title: "Bill",
          tabBarItemStyle: showBillTab ? undefined : { display: 'none' }, 
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="payments" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}