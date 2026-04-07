import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import { THEME } from "../../constants/theme";
import { useSession } from "../../context/SessionContext";
import { initEcho } from "../../services/echo";
import { OrderService } from "../../services/order.service";
import { SessionService } from "../../services/session.service";

export default function BillsTab() {
  const {
    sessionToken,
    tableData,
    menuData,
    orders,
    setOrders,
    isPrimary,
    customerName,
    clearSession,
  } = useSession();
  const { billRequested } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "live" | "offline"
  >("connecting");
  const [paymentData, setPaymentData] = useState<any>(null);

  const echoRef = useRef<any>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  const currency = menuData?.restaurant?.currency_symbol || "₹";
  const sessionId =
    menuData?.session?.id || menuData?.session?.session_id || tableData?.tId;

  const mergeOrders = (incomingOrders: any[]) => {
    setOrders((prev) => {
      const map = new Map(prev.map((o) => [o.id, o]));
      incomingOrders.forEach((incoming) => {
        const existing = map.get(incoming.id);
        if (existing) {
          map.set(incoming.id, {
            ...existing,
            ...incoming,
            items:
              incoming.items && incoming.items.length > 0
                ? incoming.items
                : existing.items,
          });
        } else {
          map.set(incoming.id, incoming);
        }
      });
      return Array.from(map.values()).sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
  };

  const fetchOrders = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionToken) return;
      try {
        const data = await OrderService.getOrders(sessionToken, signal);
        const incomingOrders = Array.isArray(data) ? data : data.orders || [];
        mergeOrders(incomingOrders);
        if (data.payment) setPaymentData(data.payment);
      } catch (e: any) {
        if (e.name !== "AbortError") console.error("Failed to fetch orders", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sessionToken],
  );

  useEffect(() => {
    const abortController = new AbortController();
    fetchOrders(abortController.signal);
    return () => abortController.abort();
  }, [fetchOrders]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
    if (connectionStatus === "offline" && echoRef.current) {
      setConnectionStatus("connecting");
      echoRef.current.connector.pusher.connection.connect();
    }
  };

  useEffect(() => {
    if (!sessionToken || !sessionId) {
      setConnectionStatus("offline");
      return;
    }

    let isMounted = true;
    if (!echoRef.current) echoRef.current = initEcho(sessionToken);
    const echoInstance = echoRef.current;

    echoInstance.connector.pusher.connection.bind(
      "state_change",
      (states: any) => {
        if (!isMounted) return;
        if (states.current === "connected") setConnectionStatus("live");
        else if (states.current === "connecting")
          setConnectionStatus("connecting");
        else if (
          ["disconnected", "unavailable", "failed"].includes(states.current)
        )
          setConnectionStatus("offline");
      },
    );

    echoInstance.connector.pusher.connection.bind("error", () => {
      if (!isMounted) return;
      setConnectionStatus("offline");
    });

    echoInstance
      .private(`session.${sessionId}`)
      .listen(".OrderStatusUpdated", (event: any) => {
        if (!isMounted) return;
        if (event.order) {
          mergeOrders([event.order]);
          fetchOrders();
        }
      })
      .listen(".BillGenerated", (event: any) => {
        if (!isMounted) return;
        setPaymentData(event.paymentData);
        fetchOrders();
      })
      .listen(".SessionEnded", async () => {
        if (!isMounted) return;
        Alert.alert(
          "Thank You!",
          "Your table session has been closed. See you again!",
        );
        await clearSession();
        router.replace("/");
      });

    return () => {
      isMounted = false;
      if (echoRef.current) {
        if (echoRef.current.connector?.pusher?.connection) {
          echoRef.current.connector.pusher.connection.unbind_all();
        }
        echoRef.current.leave(`session.${sessionId}`);
        echoRef.current.disconnect();
        echoRef.current = null;
      }
    };
  }, [sessionToken, sessionId, fetchOrders]);

  const validOrders = useMemo(() => {
    return Array.isArray(orders)
      ? orders.filter(
          (o) =>
            o.status?.toLowerCase() !== "cancelled" &&
            o.status?.toLowerCase() !== "rejected",
        )
      : [];
  }, [orders]);

  const isBillPaid = paymentData?.status === "paid";
  const isBillPending = paymentData?.status === "pending";

  useEffect(() => {
    if (isBillPaid && echoRef.current && sessionId) {
      if (echoRef.current.connector?.pusher?.connection) {
        echoRef.current.connector.pusher.connection.unbind_all();
      }
      echoRef.current.leave(`session.${sessionId}`);
      echoRef.current.disconnect();
      echoRef.current = null;
      setConnectionStatus("offline");
    }
  }, [isBillPaid, sessionId]);

  const handleSelectMethod = async (method: "cash" | "upi" | "pending") => {
    if (!sessionToken) return;
    try {
      await SessionService.selectPaymentMethod(sessionToken, method);
      setPaymentData((prev: any) => ({ ...prev, payment_method: method }));
    } catch (e) {
      Alert.alert("Error", "Could not select payment method.");
    }
  };

  const { consolidatedItems, rawSubtotal, totalItemsCount } = useMemo(() => {
    const itemMap = new Map();
    let total = 0;
    let qtyCount = 0;
    validOrders.forEach((order) => {
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const key = item.menu_item_id || item.item_name;
          const itemName =
            item.menu_item?.name || item.item_name || "Menu Item";
          const itemPrice =
            parseFloat(String(item.unit_price || item.price || 0)) || 0;
          const itemQty = parseInt(String(item.quantity || 1), 10) || 1;

          total += itemPrice * itemQty;
          qtyCount += itemQty;
          if (itemMap.has(key)) {
            const existing = itemMap.get(key);
            existing.quantity += itemQty;
            existing.total_price += itemPrice * itemQty;
          } else {
            itemMap.set(key, {
              id: key,
              name: itemName,
              unit_price: itemPrice,
              quantity: itemQty,
              total_price: itemPrice * itemQty,
            });
          }
        });
      }
    });
    return {
      consolidatedItems: Array.from(itemMap.values()),
      rawSubtotal: total || 0,
      totalItemsCount: qtyCount || 0,
    };
  }, [validOrders]);

  const finalSubtotal = parseFloat(paymentData?.subtotal || rawSubtotal || 0);
  const finalDiscount = parseFloat(paymentData?.discount_amount || 0);
  const finalTax = parseFloat(paymentData?.tax_amount || 0);
  const finalGrandTotal = parseFloat(
    paymentData?.amount || finalSubtotal - finalDiscount + finalTax || 0,
  );

  const restaurantName = menuData?.restaurant?.name || "Restaurant Bill";
  const restaurantLogo = menuData?.restaurant?.logo || null;
  const tableNum = menuData?.table?.number || tableData?.tId || "-";
  const displayHostName = isPrimary
    ? customerName
    : menuData?.session?.host_name || "Customer";

  // 👇 PRODUCTION-GRADE UPI STRING GENERATION 👇
  const upiId = paymentData?.upi_id || menuData?.restaurant?.upi_id || "";

  // 1. Strictly encode all dynamic parameters
  const pa = encodeURIComponent(upiId);
  const pn = encodeURIComponent(restaurantName);
  const tn = encodeURIComponent(`Bill for Table ${tableNum}`);

  // 2. Pull the backend-generated Transaction ID and MC Code
  const tr = encodeURIComponent(
    paymentData?.transaction_reference || `TXN${Date.now()}`,
  );
  const mc = encodeURIComponent(paymentData?.merchant_category_code || "5812");

  // 3. Format amount strictly to 2 decimal places
  const am = finalGrandTotal.toFixed(2);
  const cu = "INR";

  // 4. Assemble the deep link
  const upiString = `upi://pay?pa=${pa}&pn=${pn}&tr=${tr}&tn=${tn}&mc=${mc}&am=${am}&cu=${cu}`;

  const handleDownloadBill = async () => {
    if (!isBillPaid) return;
    setIsDownloading(true);

    const dateStr = new Date().toLocaleString();
    let itemsHtml = "";

    consolidatedItems.forEach((item) => {
      itemsHtml += `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; font-size: 14px; margin-bottom: 12px; color: #1f2937;">
          <div>
             <span style="font-weight: 700;">
               <span style="color: #6b7280; margin-right: 4px;">${item.quantity}x</span>${item.name}
             </span>
             <br>
             <span style="font-size: 10px; color: #6b7280; text-transform: uppercase;">[ITEM]</span>
          </div>
          <span style="font-weight: 800; white-space: nowrap;">
            ${currency}${(item.total_price || 0).toFixed(2)}
          </span>
        </div>
      `;
    });

    const receiptHTML = `
      <div style="padding: 30px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background: #ffffff; max-width: 500px; margin: auto;">
        
        ${
          restaurantLogo
            ? `<div style="text-align: center; margin-bottom: 12px;">
                 <img src="${restaurantLogo}" alt="Restaurant Logo" style="max-height: 60px; max-width: 150px; object-fit: contain; border-radius: 8px;" />
               </div>`
            : ""
        }

        <div style="text-align: center; font-size: 24px; font-weight: 900; color: #111827; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px;">${restaurantName}</div>
        <div style="text-align: center; font-size: 12px; color: #6b7280; margin-bottom: 30px;">${dateStr}</div>

        <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px;">
          <div style="text-align: center; font-size: 22px; font-weight: 900; margin-bottom: 4px;">TABLE ${tableNum}</div>
          <div style="text-align: center; font-size: 10px; font-weight: 700; color: #6b7280; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 24px;">FINAL BILLING SUMMARY</div>

          <div style="background-color: #f3f4f6; padding: 10px 14px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 700; margin-bottom: 24px;">
            <span>👑 HOST: ${displayHostName}</span>
            <span style="font-weight: 400; font-size: 12px; color: #6b7280;">(${totalItemsCount} Items)</span>
          </div>

          <div style="margin-bottom: 24px;">
            ${itemsHtml}
          </div>

          <div style="border-top: 2px solid #111827; padding-top: 16px; margin-top: 24px;">
            <div style="display: flex; justify-content: space-between; font-size: 14px; color: #4b5563; margin-bottom: 8px;">
              <span>Total Orders Delivered:</span>
              <span>${totalItemsCount}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; font-size: 14px; color: #111827; font-weight: 700; margin-bottom: 8px; margin-top: 12px;">
              <span>Subtotal:</span>
              <span>${currency}${finalSubtotal.toFixed(2)}</span>
            </div>

            ${
              finalDiscount > 0
                ? `
            <div style="display: flex; justify-content: space-between; font-size: 14px; color: #059669; margin-bottom: 8px;">
              <span>Discount:</span>
              <span style="font-weight: 700;">- ${currency}${finalDiscount.toFixed(2)}</span>
            </div>`
                : ""
            }

            ${
              finalTax > 0
                ? `
            <div style="display: flex; justify-content: space-between; font-size: 14px; color: #dc2626; margin-bottom: 8px;">
              <span>Tax:</span>
              <span style="font-weight: 700;">+ ${currency}${finalTax.toFixed(2)}</span>
            </div>`
                : ""
            }

            <div style="display: flex; justify-content: space-between; font-size: 20px; font-weight: 900; color: #111827; margin-top: 16px; padding-top: 12px; border-top: 1px dashed #d1d5db;">
              <span>GRAND TOTAL</span>
              <span>${currency}${finalGrandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin-top: 40px; font-size: 12px; font-weight: 600; color: #6b7280;">
          Thank You for Visiting!
        </div>
      </div>
    `;

    try {
      if (Platform.OS === "web") {
        const generateWebPDF = () => {
          const opt = {
            margin: 0.5,
            filename: `Bill_Table_${tableNum}.pdf`,
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
          };

          (window as any)
            .html2pdf()
            .set(opt)
            .from(receiptHTML)
            .save()
            .then(() => setIsDownloading(false));
        };

        if (!(window as any).html2pdf) {
          const script = document.createElement("script");
          script.src =
            "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
          script.onload = generateWebPDF;
          document.head.appendChild(script);
        } else {
          generateWebPDF();
        }
      } else {
        const { uri } = await Print.printToFileAsync({ html: receiptHTML });
        await Sharing.shareAsync(uri, {
          UTI: ".pdf",
          mimeType: "application/pdf",
        });
        setIsDownloading(false);
      }
    } catch (err) {
      setIsDownloading(false);
      Alert.alert("Error", "Could not generate PDF bill.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Final Bill</Text>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={onRefresh}
          disabled={refreshing || loading}
        >
          <Ionicons name="reload" size={18} color={THEME.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={THEME.primary}
          />
        }
      >
        {loading && !paymentData ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={THEME.primary} />
            <Text style={styles.emptyStateText}>Loading bill...</Text>
          </View>
        ) : !paymentData ? (
          <View style={styles.emptyState}>
            <Ionicons
              name="hourglass-outline"
              size={64}
              color={THEME.textSecondary}
              style={{ opacity: 0.3 }}
            />
            <Text style={styles.emptyStateTitle}>Bill Not Generated Yet</Text>
            <Text style={styles.emptyStateText}>
              Please wait while the manager generates your final bill with
              applicable taxes and discounts.
            </Text>
          </View>
        ) : (
          <View style={{ padding: 16 }}>
            {/* BILL SUMMARY CARD */}
            <View style={styles.receiptCard}>
              <Text style={styles.receiptTitle}>Table {tableNum}</Text>
              <Text style={styles.receiptSubtitle}>FINAL BILLING SUMMARY</Text>

              <View style={styles.hostBadge}>
                <Text style={styles.hostBadgeText}>
                  👑 HOST: {displayHostName}
                </Text>
                <Text style={styles.hostBadgeSub}>
                  ({totalItemsCount} Items)
                </Text>
              </View>

              <View style={styles.itemsContainer}>
                {consolidatedItems.map((item, idx) => (
                  <View key={idx} style={styles.itemRow}>
                    <View style={{ flexDirection: "row", flex: 1 }}>
                      <Text style={styles.itemQty}>{item.quantity}x</Text>
                      <View>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemCat}>[ITEM]</Text>
                      </View>
                    </View>
                    <Text style={styles.itemPrice}>
                      {currency}
                      {(item.total_price || 0).toFixed(2)}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.summarySection}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal:</Text>
                  <Text style={styles.summaryValue}>
                    {currency}
                    {finalSubtotal.toFixed(2)}
                  </Text>
                </View>
                {finalDiscount > 0 && (
                  <View style={styles.summaryRow}>
                    <Text
                      style={[styles.summaryLabel, { color: THEME.success }]}
                    >
                      Discount:
                    </Text>
                    <Text
                      style={[styles.summaryValue, { color: THEME.success }]}
                    >
                      -{currency}
                      {finalDiscount.toFixed(2)}
                    </Text>
                  </View>
                )}
                {finalTax > 0 && (
                  <View style={styles.summaryRow}>
                    <Text
                      style={[styles.summaryLabel, { color: THEME.danger }]}
                    >
                      Tax:
                    </Text>
                    <Text
                      style={[styles.summaryValue, { color: THEME.danger }]}
                    >
                      +{currency}
                      {finalTax.toFixed(2)}
                    </Text>
                  </View>
                )}
                <View style={styles.grandTotalRow}>
                  <Text style={styles.grandTotalLabel}>GRAND TOTAL</Text>
                  <Text style={styles.grandTotalValue}>
                    {currency}
                    {finalGrandTotal.toFixed(2)}
                  </Text>
                </View>
              </View>
            </View>

            {/* DYNAMIC PAYMENT UI */}
            {isBillPaid ? (
              <TouchableOpacity
                style={styles.downloadBigBtn}
                onPress={handleDownloadBill}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons
                      name="document-text-outline"
                      size={24}
                      color="#fff"
                    />
                    <Text style={styles.downloadBigBtnText}>
                      Download PDF Bill
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : isBillPending && paymentData.payment_method === "pending" ? (
              <View>
                <Text style={styles.methodHeader}>Select Payment Method</Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity
                    style={styles.methodBtn}
                    onPress={() => handleSelectMethod("cash")}
                  >
                    <Ionicons
                      name="cash-outline"
                      size={24}
                      color={THEME.primary}
                    />
                    <Text style={styles.methodBtnText}>Pay with Cash</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.methodBtn}
                    onPress={() => handleSelectMethod("upi")}
                  >
                    <Ionicons
                      name="qr-code-outline"
                      size={24}
                      color={THEME.primary}
                    />
                    <Text style={styles.methodBtnText}>Pay with UPI</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : isBillPending && paymentData.payment_method === "upi" ? (
              <View style={styles.upiContainer}>
                <Text style={styles.upiHeader}>Scan to Pay</Text>
                <View style={styles.qrWrapper}>
                  {upiId ? (
                    <QRCode value={upiString} size={180} />
                  ) : (
                    <Text>UPI ID not configured</Text>
                  )}
                </View>
                <Text style={styles.upiSubText}>ID: {upiId}</Text>
                <TouchableOpacity
                  style={styles.upiLinkBtn}
                  onPress={() => Linking.openURL(upiString)}
                >
                  <Text style={styles.upiLinkBtnText}>Open UPI App</Text>
                </TouchableOpacity>
                <Text style={styles.waitingText}>
                  Waiting for manager to confirm payment...
                </Text>

                {/* 👇 NEW: Change Method Button 👇 */}
                <TouchableOpacity
                  style={styles.changeMethodBtn}
                  onPress={() => handleSelectMethod("pending")}
                >
                  <Text style={styles.changeMethodText}>
                    Change Payment Method
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.unpaidWarning}>
                <Text style={styles.unpaidText}>
                  Please pay cash at the counter. Waiting for manager
                  confirmation...
                </Text>

                {/* 👇 NEW: Change Method Button 👇 */}
                <TouchableOpacity
                  style={styles.changeMethodBtn}
                  onPress={() => handleSelectMethod("pending")}
                >
                  <Text style={styles.changeMethodText}>
                    Change Payment Method
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "android" ? 40 : 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    alignItems: "center",
    backgroundColor: THEME.cardBg,
  },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: THEME.textPrimary },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.background,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: THEME.border,
    ...(Platform.OS === "web" ? { cursor: "pointer" } : ({} as any)),
  },
  scrollContent: { flexGrow: 1, paddingBottom: 40 },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: THEME.textSecondary,
    textAlign: "center",
  },
  receiptCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    width: "100%",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 24,
    ...Platform.select({
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  receiptTitle: {
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    color: "#111827",
    textTransform: "uppercase",
  },
  receiptSubtitle: {
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    color: "#6B7280",
    letterSpacing: 1.5,
    marginBottom: 24,
  },
  hostBadge: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#F3F4F6",
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
  },
  hostBadgeText: { fontWeight: "700", fontSize: 14, color: "#111827" },
  hostBadgeSub: { fontWeight: "400", fontSize: 12, color: "#6B7280" },
  itemsContainer: { marginBottom: 24 },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  itemQty: { color: "#6B7280", fontWeight: "700", marginRight: 6 },
  itemName: { fontWeight: "700", color: "#111827", fontSize: 14 },
  itemCat: { fontSize: 10, color: "#6B7280", marginTop: 2 },
  itemPrice: { fontWeight: "800", color: "#111827", fontSize: 14 },
  summarySection: {
    borderTopWidth: 2,
    borderTopColor: "#111827",
    paddingTop: 16,
    marginTop: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  summaryLabel: { fontSize: 14, color: "#4B5563" },
  summaryValue: { fontSize: 14, color: "#111827", fontWeight: "700" },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#D1D5DB",
    borderStyle: "dashed",
  },
  grandTotalLabel: { fontSize: 20, fontWeight: "900", color: "#111827" },
  grandTotalValue: { fontSize: 20, fontWeight: "900", color: "#111827" },
  downloadBigBtn: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: THEME.primary,
    paddingVertical: 18,
    borderRadius: 16,
    gap: 10,
    shadowColor: THEME.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  downloadBigBtnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  unpaidWarning: {
    backgroundColor: "#fffbeb",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fde68a",
    width: "100%",
  },
  unpaidText: { color: "#d97706", textAlign: "center", fontWeight: "600" },
  methodHeader: {
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 12,
    color: THEME.textPrimary,
  },
  methodBtn: {
    flex: 1,
    backgroundColor: THEME.cardBg,
    borderWidth: 2,
    borderColor: THEME.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  methodBtnText: { color: THEME.primary, fontWeight: "bold", marginTop: 8 },
  upiContainer: {
    alignItems: "center",
    backgroundColor: THEME.cardBg,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  upiHeader: { fontSize: 18, fontWeight: "bold", marginBottom: 16 },
  qrWrapper: {
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    elevation: 2,
  },
  upiSubText: { marginTop: 12, color: THEME.textSecondary, fontWeight: "bold" },
  upiLinkBtn: {
    marginTop: 16,
    backgroundColor: THEME.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  upiLinkBtnText: { color: "#fff", fontWeight: "bold" },
  waitingText: {
    marginTop: 16,
    color: THEME.warning,
    fontWeight: "bold",
    fontStyle: "italic",
    textAlign: "center",
  },
  changeMethodBtn: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.border,
    alignSelf: "center",
  },
  changeMethodText: {
    color: THEME.textSecondary,
    fontWeight: "bold",
    fontSize: 12,
    textAlign: "center",
  },
});
