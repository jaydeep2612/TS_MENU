import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { default as React, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../../constants/theme";
import { useSession } from "../../context/SessionContext";
import { initEcho } from "../../services/echo";
import { SessionService } from "../../services/session.service";

const { width } = Dimensions.get("window");

// ─── Ann Sathi Brand Colors ──────────────────────────────────────────────────
const ANN = {
  orange: "#fe9a54",
  red: "#f16b3f",
  blue: "#456aba",
  darkBlue: "#2a4795",
  orangeLight: "#fff4ec",
  redLight: "#fff0eb",
  blueLight: "#eef2fb",
  darkBlueLight: "#e8ecf7",
};
// ─────────────────────────────────────────────────────────────────────────────

const DUMMY_MENU = [
  {
    id: 1,
    name: "Truffle Burger",
    price: 22.5,
    desc: "Wagyu beef, truffle aioli, caramelized onions, Gruyère cheese, brioche bun.",
    is_popular: true,
    type: "non-veg",
    image_path:
      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=300&auto=format&fit=crop",
    is_out_of_stock: false,
    is_limited_stock: false,
    stock_label: null,
  },
  {
    id: 2,
    name: "Basil Pesto Pasta",
    price: 18.9,
    desc: "Handmade linguine, house-made basil pesto, toasted pine nuts, parmesan.",
    is_popular: false,
    type: "veg",
    image_path:
      "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?q=80&w=300&auto=format&fit=crop",
    is_out_of_stock: false,
    is_limited_stock: false,
    stock_label: null,
  },
];

const FALLBACK_CATEGORIES = [
  { id: 1, name: "Mains", items: DUMMY_MENU, is_active: true },
  { id: 2, name: "Appetizers", items: [], is_active: true },
  { id: 3, name: "Drinks", items: [], is_active: true },
  { id: 4, name: "Desserts", items: [], is_active: true },
];

export default function MenuScreen() {
  const {
    cart,
    updateCart,
    cartTotalQty,
    cartTotalPrice,
    setMenuData,
    tableData,
    joinStatus,
    sessionToken,
    menuData,
    isPrimary,
    customerName,
    clearSession,
  } = useSession();

  const [activeCategoryId, setActiveCategoryId] = useState<string | number>(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState<"all" | "veg" | "non-veg">(
    "all",
  );
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(true);

  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [activeGuests, setActiveGuests] = useState<any[]>([]);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const echoRef = useRef<any>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());
  const mainScrollViewRef = useRef<ScrollView>(null);

  const currentSessionId =
    menuData?.session?.id ||
    menuData?.session?.session_id ||
    menuData?.session_id ||
    tableData?.tId;

  // ─── 1. FETCH MENU ───────────────────────────────────────────────────────
  useEffect(() => {
    const loadMenu = async () => {
      if (!tableData || !sessionToken) return;
      try {
        setLoadingMenu(true);
        const data = await SessionService.fetchMenu(
          tableData.rId,
          tableData.tId,
          tableData.token,
          sessionToken,
        );
        if (data && data.categories) {
          setMenuData(data);
        } else {
          setMenuData({ categories: FALLBACK_CATEGORIES });
        }
      } catch (e: any) {
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          await clearSession();
          if (Platform.OS === "web") {
            window.alert(
              "Session Expired. Please scan the table QR code again.",
            );
          } else {
            Alert.alert(
              "Session Expired",
              "Please scan the table QR code again.",
            );
          }
          router.replace("/");
          return;
        }
        setMenuData({ categories: FALLBACK_CATEGORIES });
      } finally {
        setLoadingMenu(false);
      }
    };
    loadMenu();
  }, [tableData, sessionToken]);

  // ─── 2. REALTIME HOST LISTENERS ─────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    const setupHostListener = async () => {
      if (!tableData?.tId || !sessionToken || !isPrimary || !currentSessionId)
        return;
      try {
        const res = await SessionService.getPendingRequests(
          tableData.tId,
          sessionToken,
        );
        if (isMounted) {
          setPendingRequests(res.pending || []);
          setActiveGuests(res.guests || []);
          if (res.pending && res.pending.length > 0) setShowRequestsModal(true);
        }
      } catch (e) {
        console.error("Failed to fetch host data", e);
      }

      if (!echoRef.current) echoRef.current = initEcho(sessionToken);

      const channel = echoRef.current.private(`session.${currentSessionId}`);

      channel.listen(".GuestJoinRequested", (event: any) => {
        if (!isMounted) return;
        if (event.event_id) {
          if (processedEventsRef.current.has(event.event_id)) return;
          processedEventsRef.current.add(event.event_id);
        }
        if (event.guest) {
          setPendingRequests((prev: any[]) => {
            if (prev.some((g: any) => g.id === event.guest.id)) return prev;
            return [...prev, event.guest];
          });
          setShowRequestsModal(true);
        }
      });

      channel.listen(".SessionEnded", async () => {
        if (!isMounted) return;
        Alert.alert(
          "Thank You!",
          "Your table session has been closed by the restaurant. We hope to see you again soon!",
        );
        await clearSession();
        router.replace("/");
      });
    };

    setupHostListener();

    return () => {
      isMounted = false;
      if (echoRef.current && currentSessionId) {
        if (echoRef.current.connector?.pusher?.connection) {
          echoRef.current.connector.pusher.connection.unbind_all();
        }
        echoRef.current.leave(`session.${currentSessionId}`);
      }
    };
  }, [isPrimary, tableData?.tId, sessionToken, currentSessionId]);

  const handleRequestResponse = async (
    id: number,
    action: "approve" | "reject",
  ) => {
    if (!sessionToken) return;
    const guestToMove = pendingRequests.find((r) => r.id === id);
    try {
      await SessionService.respondToRequest(id, action, sessionToken);
      setPendingRequests((prev) => {
        const updated = prev.filter((r) => r.id !== id);
        if (updated.length === 0) setShowRequestsModal(false);
        return updated;
      });
      if (action === "approve" && guestToMove) {
        setActiveGuests((prev) => [...prev, guestToMove]);
      }
    } catch (e) {
      Alert.alert("Error", "Could not process the request. Please try again.");
    }
  };

  const handleLeaveTable = () => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm(
        "Are you sure you want to disconnect from this table?",
      );
      if (confirmed) clearSession().then(() => router.replace("/"));
      return;
    }
    Alert.alert(
      "Leave Table?",
      "Are you sure you want to disconnect from this table? Your cart and session will be cleared.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            await clearSession();
            router.replace("/");
          },
        },
      ],
    );
  };

  const handleCallWaiter = () => {
    if (!sessionToken) return;
    Alert.alert("Call Waiter", "Do you need a waiter at your table?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes",
        onPress: async () => {
          try {
            await SessionService.callWaiter(sessionToken);
            Alert.alert("Success", "A waiter has been notified.");
          } catch (error) {
            Alert.alert("Error", "Could not notify the waiter at this time.");
          }
        },
      },
    ]);
  };

  const categories = menuData?.categories || FALLBACK_CATEGORIES;

  const hasNonVegItems = useMemo(() => {
    return categories.some((cat: any) => {
      if (!cat.items) return false;
      return cat.items.some((item: any) => {
        const type = item.type
          ? String(item.type).toLowerCase()
          : item.is_veg === false
            ? "non-veg"
            : "veg";
        return type === "non-veg";
      });
    });
  }, [categories]);

  // ── Count out-of-stock items for banner ──
  const outOfStockCount = useMemo(() => {
    let count = 0;
    categories.forEach((cat: any) => {
      (cat.items || []).forEach((item: any) => {
        if (item.is_out_of_stock) count++;
      });
    });
    return count;
  }, [categories]);

  const processedCategories = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return categories
      .map((cat: any) => {
        if (cat.is_active === false || cat.is_active === 0) return null;

        const filteredItems = (cat.items || []).filter((item: any) => {
          // If hide out of stock is on, skip those items
          if (hideOutOfStock && item.is_out_of_stock) return false;

          const safeType = item.type
            ? String(item.type).toLowerCase()
            : item.is_veg === false
              ? "non-veg"
              : "veg";

          if (dietaryFilter !== "all" && safeType !== dietaryFilter)
            return false;

          if (query) {
            const matchName = item.name?.toLowerCase().includes(query);
            const matchDesc =
              item.description?.toLowerCase().includes(query) ||
              item.desc?.toLowerCase().includes(query);
            if (!matchName && !matchDesc) return false;
          }
          return true;
        });

        // Sort: available first, then out-of-stock at bottom; within each group sort by price
        filteredItems.sort((a: any, b: any) => {
          if (a.is_out_of_stock && !b.is_out_of_stock) return 1;
          if (!a.is_out_of_stock && b.is_out_of_stock) return -1;
          return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
        });

        return { ...cat, items: filteredItems };
      })
      .filter((cat: any) => cat && cat.items.length > 0);
  }, [categories, searchQuery, dietaryFilter, hideOutOfStock]);

  const isApproved = joinStatus === "active" || joinStatus === "approved";
  const isOrderingLocked = !isApproved;
  const restaurantName = menuData?.restaurant?.name || "Loading...";
  const restaurantLogo = menuData?.restaurant?.logo;
  const tableNumber = menuData?.table?.number || tableData?.tId || "?";
  const tableCapacity = menuData?.table?.capacity || "-";
  const displayHostName = isPrimary
    ? customerName
    : menuData?.session?.host_name || "Host";

  const currentCatIndex = processedCategories.findIndex(
    (c: any) => c.id === activeCategoryId,
  );
  const nextCategory =
    currentCatIndex !== -1 && currentCatIndex < processedCategories.length - 1
      ? processedCategories[currentCatIndex + 1]
      : null;

  const handleCategoryChange = (id: string | number) => {
    setActiveCategoryId(id);
    mainScrollViewRef.current?.scrollTo({ y: 0, animated: true });
  };

  // ─── STOCK BADGE COMPONENT ──────────────────────────────────────────────
  const StockBadge = ({
    item,
    currentQty,
  }: {
    item: any;
    currentQty: number;
  }) => {
    if (item.is_out_of_stock) {
      return (
        <View style={styles.outOfStockBadge}>
          <Text style={styles.outOfStockBadgeText}>Out of Stock</Text>
        </View>
      );
    }

    // Show "Only X left" when limited stock
    if (item.is_limited_stock && item.stock_label) {
      const remaining = item.stock_quantity - currentQty;
      return (
        <View style={styles.limitedStockBadge}>
          <MaterialIcons name="access-time" size={9} color="#92400e" />
          <Text style={styles.limitedStockBadgeText}>
            {remaining > 0
              ? `Only ${remaining} left${currentQty > 0 ? ` (${currentQty} in cart)` : ""}`
              : `Max ${item.stock_quantity} in cart`}
          </Text>
        </View>
      );
    }

    // Even if not "limited stock" tier, warn when cart qty is getting close to stock cap
    if (
      item.track_stock === true &&
      item.stock_quantity !== null &&
      currentQty > 0 &&
      currentQty >= item.stock_quantity
    ) {
      return (
        <View style={styles.limitedStockBadge}>
          <MaterialIcons name="check-circle" size={9} color="#92400e" />
          <Text style={styles.limitedStockBadgeText}>Max qty reached</Text>
        </View>
      );
    }

    return null;
  };

  // ─── STOCK-AWARE ADD TO CART ────────────────────────────────────────────
  // Called instead of updateCart(+1) so we can enforce stock limits
  const handleAddToCart = (item: any) => {
    const currentQty = cart[item.id]?.qty || 0;
    const itemPrice = parseFloat(item.price) || 0;

    // Hard stock cap: if track_stock is on and stock_quantity is set,
    // never allow cart qty to exceed available stock
    if (
      item.track_stock === true &&
      item.stock_quantity !== null &&
      item.stock_quantity !== undefined
    ) {
      const maxAllowed = Number(item.stock_quantity);

      if (currentQty >= maxAllowed) {
        // Show a friendly alert — same pattern as rest of app
        if (Platform.OS === "web") {
          window.alert(
            `Only ${maxAllowed} unit${maxAllowed !== 1 ? "s" : ""} of "${item.name}" are available. You already have ${currentQty} in your cart.`,
          );
        } else {
          Alert.alert(
            "Stock Limit Reached",
            `Only ${maxAllowed} unit${maxAllowed !== 1 ? "s" : ""} of "${item.name}" are available.\nYou already have ${currentQty} in your cart.`,
            [{ text: "OK" }],
          );
        }
        return; // block the add
      }
    }

    updateCart(item.id, 1, itemPrice, item.name);
  };

  // ─── CARD RENDERER ──────────────────────────────────────────────────────
  const renderMenuItemCard = (item: any) => {
    const currentQty = cart[item.id]?.qty || 0;
    const itemPrice = parseFloat(item.price) || 0;
    const isPopular = item.is_popular;
    const isOutOfStock = item.is_out_of_stock === true;
    const isLimited = item.is_limited_stock === true;

    // Whether this item has a hard stock cap (track_stock ON + qty set)
    const hasStockCap =
      item.track_stock === true &&
      item.stock_quantity !== null &&
      item.stock_quantity !== undefined;
    const maxAllowed = hasStockCap ? Number(item.stock_quantity) : Infinity;
    const isAtStockLimit = hasStockCap && currentQty >= maxAllowed;

    const safeType = item.type
      ? String(item.type).toLowerCase()
      : item.is_veg === false
        ? "non-veg"
        : "veg";

    return (
      <View
        key={`item-${item.id}`}
        style={[
          styles.gridCard,
          (isOrderingLocked || isOutOfStock) && {
            opacity: isOutOfStock ? 0.55 : 0.6,
          },
        ]}
      >
        {/* Image with out-of-stock overlay */}
        <View style={styles.cardImageWrapper}>
          <Image
            source={{
              uri:
                item.image ||
                item.image_path ||
                "https://via.placeholder.com/150",
            }}
            style={[
              styles.cardImage,
              isOutOfStock && styles.cardImageGrayscale,
            ]}
          />
          {/* Out of stock ribbon overlay on image */}
          {isOutOfStock && (
            <View style={styles.outOfStockOverlay}>
              <Text style={styles.outOfStockOverlayText}>SOLD OUT</Text>
            </View>
          )}
          {/* Popular badge on image */}
          {isPopular && !isOutOfStock && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>⭐ Popular</Text>
            </View>
          )}
        </View>

        <View style={styles.cardContent}>
          {/* Veg / Non-Veg indicator */}
          <View style={styles.typeRow}>
            <View
              style={[
                styles.typeIndicator,
                safeType === "veg"
                  ? styles.vegIndicator
                  : styles.nonVegIndicator,
              ]}
            >
              <View
                style={[
                  styles.typeInnerDot,
                  safeType === "veg"
                    ? styles.vegDotInner
                    : styles.nonVegDotInner,
                ]}
              />
            </View>
            <Text style={styles.typeLabel}>
              {safeType === "veg" ? "Veg" : "Non-Veg"}
            </Text>
          </View>

          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.name}
          </Text>

          <Text style={styles.cardDesc} numberOfLines={2}>
            {item.description || item.desc || ""}
          </Text>

          {/* Stock badge (out of stock / limited / max reached) */}
          <StockBadge item={item} currentQty={currentQty} />

          <View style={styles.cardBottomRow}>
            <Text
              style={[styles.cardPrice, isOutOfStock && { color: "#9CA3AF" }]}
            >
              ₹{itemPrice.toFixed(2)}
            </Text>

            {/* Stepper / Add Button — disabled if out of stock or ordering locked */}
            {!isOrderingLocked &&
              (isOutOfStock ? (
                <View style={styles.notifyBtn}>
                  <Text style={styles.notifyBtnText}>Notify</Text>
                </View>
              ) : (
                <View style={styles.stepperContainer}>
                  <TouchableOpacity
                    onPress={() =>
                      updateCart(item.id, -1, itemPrice, item.name)
                    }
                    style={styles.stepperBtn}
                    disabled={currentQty === 0}
                  >
                    <MaterialIcons
                      name="remove"
                      size={14}
                      color={currentQty === 0 ? "#D1D5DB" : "#94A3B8"}
                    />
                  </TouchableOpacity>

                  <Text
                    style={[
                      styles.stepperQty,
                      currentQty > 0 && styles.stepperQtyActive,
                    ]}
                  >
                    {currentQty}
                    {/* Show max cap hint e.g. "3/5" when limited */}
                    {hasStockCap && currentQty > 0 && (
                      <Text style={styles.stepperQtyMax}>/{maxAllowed}</Text>
                    )}
                  </Text>

                  {/* + button: disabled & greyed when at stock limit */}
                  <TouchableOpacity
                    onPress={() => handleAddToCart(item)}
                    style={[
                      styles.stepperBtnDark,
                      isAtStockLimit && styles.stepperBtnDisabled,
                    ]}
                    disabled={isAtStockLimit}
                  >
                    <MaterialIcons
                      name="add"
                      size={14}
                      color={isAtStockLimit ? "#E5E7EB" : "#FFF"}
                    />
                  </TouchableOpacity>
                </View>
              ))}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.mainWrapper}>
      <View style={styles.bgOverlay} />

      <SafeAreaView style={styles.container}>
        {/* ── TOP BAR ── */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={handleLeaveTable}>
            <MaterialIcons name="exit-to-app" size={26} color={THEME.danger} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 2,
              }}
            >
              {restaurantLogo ? (
                <Image
                  source={{ uri: restaurantLogo }}
                  style={styles.headerLogo}
                />
              ) : (
                <MaterialIcons
                  name="restaurant"
                  size={16}
                  color={ANN.orange}
                  style={{ marginRight: 6 }}
                />
              )}
              <Text style={styles.topBarTitle}>
                Table {tableNumber} • {restaurantName}
              </Text>
            </View>

            <View style={styles.tableSubInfo}>
              <MaterialIcons
                name="groups"
                size={12}
                color={THEME.textSecondary}
              />
              <Text style={styles.tableSubInfoText}>Cap: {tableCapacity}</Text>
              <Text style={styles.tableSubInfoDot}>•</Text>
              <MaterialIcons name="stars" size={12} color={ANN.orange} />
              <Text style={styles.tableSubInfoText}>
                Host: {displayHostName}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TouchableOpacity style={styles.bellBtn} onPress={handleCallWaiter}>
              <MaterialIcons
                name="notifications-active"
                size={24}
                color={ANN.orange}
              />
            </TouchableOpacity>

            {isPrimary ? (
              <TouchableOpacity
                style={[
                  styles.hostBadge,
                  pendingRequests.length > 0 && {
                    backgroundColor: THEME.danger,
                  },
                ]}
                onPress={() => setShowRequestsModal(true)}
              >
                <MaterialIcons name="people" size={16} color="#FFF" />
                <Text style={styles.hostBadgeText}>
                  {activeGuests.length + pendingRequests.length}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.iconBtn}>
                <MaterialIcons
                  name="info-outline"
                  size={24}
                  color={THEME.textPrimary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loadingMenu ? (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <ActivityIndicator size="large" color={ANN.orange} />
            <Text style={{ marginTop: 12, color: THEME.textSecondary }}>
              Loading Menu...
            </Text>
          </View>
        ) : (
          <View style={styles.splitLayout}>
            {/* ── LEFT SIDEBAR ── */}
            <View style={styles.sidebar}>
              <Text style={styles.sidebarSectionTitle}>MENU</Text>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.sidebarScroll}
              >
                <TouchableOpacity
                  style={[
                    styles.sidebarItem,
                    activeCategoryId === "all" && styles.sidebarItemActive,
                  ]}
                  onPress={() => handleCategoryChange("all")}
                >
                  <View style={styles.sidebarItemWrapper}>
                    <Text
                      style={[
                        styles.sidebarItemText,
                        activeCategoryId === "all" &&
                          styles.sidebarItemTextActive,
                      ]}
                    >
                      All Menu
                    </Text>
                  </View>
                </TouchableOpacity>

                {categories.map((cat: any) => {
                  if (cat.is_active === false || cat.is_active === 0)
                    return null;
                  const isActive = activeCategoryId === cat.id;

                  // Count out-of-stock in this category
                  const catOutCount = (cat.items || []).filter(
                    (i: any) => i.is_out_of_stock,
                  ).length;

                  return (
                    <TouchableOpacity
                      key={`cat-sidebar-${cat.id}`}
                      style={[
                        styles.sidebarItem,
                        isActive && styles.sidebarItemActive,
                      ]}
                      onPress={() => handleCategoryChange(cat.id)}
                    >
                      <View style={styles.sidebarItemWrapper}>
                        {isActive && <View style={styles.activeIndicatorDot} />}
                        <Text
                          style={[
                            styles.sidebarItemText,
                            isActive && styles.sidebarItemTextActive,
                          ]}
                        >
                          {cat.name}
                        </Text>
                      </View>
                      {catOutCount > 0 && (
                        <View style={styles.sidebarOutBadge}>
                          <Text style={styles.sidebarOutBadgeText}>
                            {catOutCount}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* ── RIGHT MAIN AREA ── */}
            <View style={styles.mainArea}>
              <ScrollView
                ref={mainScrollViewRef}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.mainAreaScroll}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.heroTitle}>Hungry?</Text>
                <Text style={styles.heroSubtitle}>
                  Let's Eat Something Delicious 👋
                </Text>

                {isOrderingLocked && (
                  <View style={styles.bannerLocked}>
                    <MaterialIcons
                      name="lock"
                      size={16}
                      color={ANN.orange}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={{
                        fontSize: 12,
                        color: ANN.orange,
                        fontWeight: "bold",
                      }}
                    >
                      Ordering locked until host approves.
                    </Text>
                  </View>
                )}

                {/* ── OUT OF STOCK BANNER ── */}
                {outOfStockCount > 0 && (
                  <TouchableOpacity
                    style={styles.stockBanner}
                    onPress={() => setHideOutOfStock((prev) => !prev)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.stockBannerLeft}>
                      <MaterialIcons
                        name="info-outline"
                        size={15}
                        color="#B45309"
                      />
                      <Text style={styles.stockBannerText}>
                        {outOfStockCount} item{outOfStockCount > 1 ? "s" : ""}{" "}
                        currently unavailable
                      </Text>
                    </View>
                    <View style={styles.stockBannerToggle}>
                      <Text style={styles.stockBannerToggleText}>
                        {hideOutOfStock ? "Show All" : "Hide"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}

                {/* ── SEARCH ── */}
                <View style={styles.searchContainer}>
                  <MaterialIcons
                    name="search"
                    size={20}
                    color={THEME.textSecondary}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search dishes..."
                    placeholderTextColor="#94A3B8"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery("")}>
                      <MaterialIcons
                        name="close"
                        size={20}
                        color={THEME.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>

                {/* ── FILTERS ROW ── */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 16 }}
                >
                  <View style={styles.dietaryFilterContainer}>
                    {/* Dietary filters */}
                    <TouchableOpacity
                      style={[
                        styles.dietFilterBtn,
                        dietaryFilter === "all" && styles.dietFilterBtnActive,
                      ]}
                      onPress={() => setDietaryFilter("all")}
                    >
                      <Text
                        style={[
                          styles.dietFilterText,
                          dietaryFilter === "all" &&
                            styles.dietFilterTextActive,
                        ]}
                      >
                        All
                      </Text>
                    </TouchableOpacity>

                    {hasNonVegItems && (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.dietFilterBtn,
                            dietaryFilter === "veg" &&
                              styles.dietFilterBtnActiveVeg,
                          ]}
                          onPress={() => setDietaryFilter("veg")}
                        >
                          <View style={styles.vegDot} />
                          <Text
                            style={[
                              styles.dietFilterText,
                              dietaryFilter === "veg" &&
                                styles.dietFilterTextActiveVeg,
                            ]}
                          >
                            Veg
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.dietFilterBtn,
                            dietaryFilter === "non-veg" &&
                              styles.dietFilterBtnActiveNonVeg,
                          ]}
                          onPress={() => setDietaryFilter("non-veg")}
                        >
                          <View style={styles.nonVegTriangle} />
                          <Text
                            style={[
                              styles.dietFilterText,
                              dietaryFilter === "non-veg" &&
                                styles.dietFilterTextActiveNonVeg,
                            ]}
                          >
                            Non-Veg
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {/* Available Only toggle */}
                    <TouchableOpacity
                      style={[
                        styles.dietFilterBtn,
                        hideOutOfStock && styles.dietFilterBtnAvail,
                      ]}
                      onPress={() => setHideOutOfStock((prev) => !prev)}
                    >
                      <MaterialIcons
                        name={
                          hideOutOfStock
                            ? "check-circle"
                            : "radio-button-unchecked"
                        }
                        size={13}
                        color={hideOutOfStock ? "#047857" : THEME.textSecondary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.dietFilterText,
                          hideOutOfStock && styles.dietFilterTextActiveVeg,
                        ]}
                      >
                        Available Only
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>

                {/* ── MENU GRID ── */}
                <View style={styles.menuGridContainer}>
                  {processedCategories.length === 0 ? (
                    <View style={styles.emptyState}>
                      <MaterialIcons
                        name="search-off"
                        size={40}
                        color="#CBD5E1"
                      />
                      <Text style={styles.emptySearchText}>
                        No items match your criteria.
                      </Text>
                    </View>
                  ) : (
                    processedCategories
                      .filter(
                        (c: any) =>
                          activeCategoryId === "all" ||
                          c.id === activeCategoryId,
                      )
                      .map((cat: any) => (
                        <View
                          key={`section-${cat.id}`}
                          style={{ width: "100%", marginBottom: 10 }}
                        >
                          {activeCategoryId === "all" && (
                            <View style={styles.inlineCategoryHeader}>
                              <Text style={styles.inlineCategoryTitle}>
                                {cat.name}
                              </Text>
                              <View style={styles.inlineCategoryLine} />
                            </View>
                          )}

                          <View style={styles.gridRow}>
                            {cat.items.map((item: any) =>
                              renderMenuItemCard(item),
                            )}
                          </View>

                          {activeCategoryId !== "all" && nextCategory && (
                            <TouchableOpacity
                              style={styles.nextCategoryBtn}
                              onPress={() =>
                                handleCategoryChange(nextCategory.id)
                              }
                            >
                              <Text style={styles.nextCategoryBtnText}>
                                Next: {nextCategory.name}
                              </Text>
                              <MaterialIcons
                                name="arrow-forward"
                                size={20}
                                color={ANN.blue}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      ))
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        )}

        {/* ── Cart Bar ── */}
        {cartTotalQty > 0 && !isOrderingLocked && (
          <View style={styles.cartBar}>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/cart")}
              style={styles.cartButton}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <View style={styles.cartIconWrapper}>
                  <MaterialIcons
                    name="shopping-basket"
                    size={20}
                    color={ANN.orange}
                  />
                </View>
                <View>
                  <Text style={styles.cartQty}>{cartTotalQty} items</Text>
                  <Text style={styles.cartTotal}>
                    ₹{cartTotalPrice.toFixed(2)}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={styles.viewCartText}>View Cart</Text>
                <MaterialIcons name="chevron-right" size={24} color="#FFF" />
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Requests Modal ── */}
        <Modal visible={showRequestsModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Table Management</Text>
                <TouchableOpacity onPress={() => setShowRequestsModal(false)}>
                  <MaterialIcons
                    name="cancel"
                    size={28}
                    color={THEME.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.sectionHeader}>Join Requests</Text>
                {pendingRequests.length === 0 ? (
                  <Text style={styles.emptyText}>No pending requests.</Text>
                ) : (
                  pendingRequests.map((r) => (
                    <View key={r.id} style={styles.requestRow}>
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        <MaterialIcons
                          name="person-add"
                          size={20}
                          color={ANN.orange}
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.requestName}>
                          {r.customer_name}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <TouchableOpacity
                          onPress={() => handleRequestResponse(r.id, "reject")}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: THEME.danger + "20" },
                          ]}
                        >
                          <MaterialIcons
                            name="close"
                            color={THEME.danger}
                            size={20}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleRequestResponse(r.id, "approve")}
                          style={[
                            styles.actionBtn,
                            { backgroundColor: THEME.success + "20" },
                          ]}
                        >
                          <MaterialIcons
                            name="check"
                            color={THEME.success}
                            size={20}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}

                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 24,
                    marginBottom: 12,
                  }}
                >
                  <Text style={[styles.sectionHeader, { marginBottom: 0 }]}>
                    Active Guests
                  </Text>
                  <View
                    style={{
                      backgroundColor: THEME.border,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        color: THEME.textSecondary,
                      }}
                    >
                      {activeGuests.length + 1} / {tableCapacity} Seats
                    </Text>
                  </View>
                </View>

                {activeGuests.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No guests have joined yet.
                  </Text>
                ) : (
                  activeGuests.map((g) => (
                    <View key={g.id} style={styles.requestRow}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <View
                          style={{
                            backgroundColor: THEME.successLight,
                            padding: 6,
                            borderRadius: 20,
                          }}
                        >
                          <MaterialIcons
                            name="person"
                            size={16}
                            color={THEME.success}
                          />
                        </View>
                        <Text style={styles.requestName}>
                          {g.customer_name}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── BACKGROUND ───────────────────────────────────────────────────────────
  mainWrapper: { flex: 1, backgroundColor: "#F7F8FA" },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  container: { flex: 1, maxWidth: 600, width: "100%", alignSelf: "center" },

  // ── TOP BAR ──────────────────────────────────────────────────────────────
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  headerLogo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 6,
    backgroundColor: THEME.border,
  },
  tableSubInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tableSubInfoText: {
    fontSize: 11,
    fontWeight: "600",
    color: THEME.textSecondary,
  },
  tableSubInfoDot: {
    fontSize: 10,
    color: THEME.textSecondary,
    marginHorizontal: 2,
  },
  iconBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 20,
  },
  bellBtn: { backgroundColor: ANN.orangeLight, padding: 6, borderRadius: 20 },
  topBarTitle: { fontSize: 16, fontWeight: "bold", color: THEME.textPrimary },
  hostBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ANN.darkBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  hostBadgeText: { color: "#FFF", fontWeight: "bold", fontSize: 14 },

  // ── SPLIT LAYOUT ─────────────────────────────────────────────────────────
  splitLayout: { flex: 1, flexDirection: "row" },

  // ── SIDEBAR ──────────────────────────────────────────────────────────────
  sidebar: {
    width: 100,
    backgroundColor: "#FFF",
    borderRightWidth: 1,
    borderColor: "rgba(0,0,0,0.03)",
    paddingTop: 16,
  },
  sidebarSectionTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: "#A0AEC0",
    paddingHorizontal: 16,
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  sidebarScroll: { paddingBottom: 100 },
  sidebarItem: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginHorizontal: 8,
    marginBottom: 4,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sidebarItemWrapper: { flexDirection: "row", alignItems: "center", flex: 1 },
  sidebarItemActive: { backgroundColor: ANN.darkBlue },
  activeIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ANN.red,
    marginRight: 6,
    marginTop: 2,
  },
  sidebarItemText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4A5568",
    flexShrink: 1,
    flexWrap: "wrap",
  },
  sidebarItemTextActive: { color: "#FFF", fontWeight: "bold" },
  // Out of stock count bubble in sidebar
  sidebarOutBadge: {
    backgroundColor: "#FEE2E2",
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  sidebarOutBadgeText: { fontSize: 9, fontWeight: "800", color: "#DC2626" },

  // ── MAIN AREA ─────────────────────────────────────────────────────────────
  mainArea: { flex: 1 },
  mainAreaScroll: { padding: 16, paddingBottom: 120 },
  heroTitle: { fontSize: 28, fontWeight: "900", color: ANN.darkBlue },
  heroSubtitle: {
    fontSize: 14,
    color: "#718096",
    marginTop: 4,
    marginBottom: 16,
  },

  // ── BANNERS ───────────────────────────────────────────────────────────────
  bannerLocked: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ANN.orangeLight,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },

  // ── OUT OF STOCK BANNER ───────────────────────────────────────────────────
  stockBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  stockBannerLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  stockBannerText: { fontSize: 12, fontWeight: "600", color: "#92400E" },
  stockBannerToggle: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  stockBannerToggleText: { fontSize: 11, fontWeight: "700", color: "#B45309" },

  // ── SEARCH ────────────────────────────────────────────────────────────────
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    marginBottom: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    height: 44,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  searchInput: {
    flex: 1,
    height: "100%",
    color: THEME.textPrimary,
    fontSize: 14,
  },

  // ── FILTERS ───────────────────────────────────────────────────────────────
  dietaryFilterContainer: { flexDirection: "row", gap: 8 },
  dietFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  dietFilterBtnActive: {
    backgroundColor: ANN.darkBlue,
    borderColor: ANN.darkBlue,
  },
  dietFilterBtnActiveVeg: {
    backgroundColor: "#ecfdf5",
    borderColor: "#10b981",
  },
  dietFilterBtnActiveNonVeg: {
    backgroundColor: "#fef2f2",
    borderColor: "#ef4444",
  },
  dietFilterBtnAvail: { backgroundColor: "#ecfdf5", borderColor: "#10b981" },
  dietFilterText: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.textSecondary,
  },
  dietFilterTextActive: { color: "#FFF" },
  dietFilterTextActiveVeg: { color: "#047857" },
  dietFilterTextActiveNonVeg: { color: "#b91c1c" },
  vegDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10b981",
    marginRight: 4,
  },
  nonVegTriangle: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderBottomWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#ef4444",
    marginRight: 4,
  },

  // ── CATEGORY HEADER ───────────────────────────────────────────────────────
  inlineCategoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 8,
    gap: 10,
  },
  inlineCategoryTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: ANN.darkBlue,
    letterSpacing: -0.3,
  },
  inlineCategoryLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(42,71,149,0.12)",
  },

  // ── GRID & CARDS ──────────────────────────────────────────────────────────
  menuGridContainer: { width: "100%" },
  gridRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  gridCard: {
    width: "48%",
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 10,
    marginBottom: 16,
    ...Platform.select({
      web: { boxShadow: "0px 2px 8px rgba(0,0,0,0.04)" } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },

  // Image wrapper for overlay support
  cardImageWrapper: { position: "relative", marginBottom: 10 },
  cardImage: {
    width: "100%",
    height: 100,
    borderRadius: 12,
    backgroundColor: "#F7F8FA",
    resizeMode: "cover",
  },
  cardImageGrayscale: { opacity: 0.5 },

  // SOLD OUT overlay on image
  outOfStockOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingVertical: 5,
    alignItems: "center",
  },
  outOfStockOverlayText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  // Popular badge on image
  popularBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(254,154,84,0.92)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  popularBadgeText: { fontSize: 9, fontWeight: "700", color: "#FFF" },

  cardContent: { flex: 1 },

  // Veg/NonVeg indicator (FSSAI style box)
  typeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
    gap: 5,
  },
  typeIndicator: {
    width: 14,
    height: 14,
    borderRadius: 2,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  vegIndicator: { borderColor: "#16A34A" },
  nonVegIndicator: { borderColor: "#DC2626" },
  typeInnerDot: { width: 6, height: 6, borderRadius: 3 },
  vegDotInner: { backgroundColor: "#16A34A" },
  nonVegDotInner: { backgroundColor: "#DC2626" },
  typeLabel: { fontSize: 10, color: "#94A3B8", fontWeight: "600" },

  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: ANN.darkBlue,
    marginBottom: 3,
    lineHeight: 17,
  },
  cardDesc: { fontSize: 10, color: "#9CA3AF", marginBottom: 6, lineHeight: 14 },

  // ── STOCK BADGES ──────────────────────────────────────────────────────────
  outOfStockBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FEE2E2",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginBottom: 6,
  },
  outOfStockBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#DC2626",
    letterSpacing: 0.3,
  },

  limitedStockBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginBottom: 6,
    gap: 3,
  },
  limitedStockBadgeText: { fontSize: 10, fontWeight: "700", color: "#92400E" },

  // Card bottom row: price + stepper
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  cardPrice: { fontSize: 15, fontWeight: "900", color: ANN.darkBlue },

  // Stepper
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8F9FA",
    borderRadius: 24,
    padding: 3,
    borderWidth: 1,
    borderColor: "#EDF2F7",
  },
  stepperBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFF",
  },
  stepperBtnDark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: ANN.darkBlue,
  },
  stepperBtnDisabled: { backgroundColor: "#9CA3AF" },
  stepperQty: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#9CA3AF",
    minWidth: 18,
    textAlign: "center",
  },
  stepperQtyActive: { color: ANN.darkBlue },
  stepperQtyMax: { fontSize: 9, color: "#94A3B8", fontWeight: "400" },

  // Notify me button (for out of stock)
  notifyBtn: {
    backgroundColor: ANN.orangeLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: ANN.orange + "40",
  },
  notifyBtnText: { fontSize: 11, fontWeight: "700", color: ANN.red },

  // ── EMPTY STATE ───────────────────────────────────────────────────────────
  emptyState: { alignItems: "center", paddingTop: 40 },
  emptySearchText: {
    color: THEME.textSecondary,
    fontStyle: "italic",
    marginTop: 12,
    fontSize: 14,
  },

  // ── NEXT CATEGORY ─────────────────────────────────────────────────────────
  nextCategoryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ANN.blueLight,
    padding: 14,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: ANN.blue + "40",
  },
  nextCategoryBtnText: { color: ANN.blue, fontWeight: "bold", fontSize: 14 },

  // ── CART BAR ──────────────────────────────────────────────────────────────
  cartBar: { position: "absolute", bottom: 16, left: 16, right: 16 },
  cartButton: {
    backgroundColor: ANN.darkBlue,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: "0px 4px 12px rgba(42, 71, 149, 0.35)" } as any,
      default: {
        shadowColor: ANN.darkBlue,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 5,
      },
    }),
  },
  cartIconWrapper: {
    width: 36,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  cartQty: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600" },
  cartTotal: { color: "#FFF", fontSize: 18, fontWeight: "bold" },
  viewCartText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 4,
  },

  // ── MODALS ────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(28,28,30,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderColor: THEME.border,
  },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: THEME.textPrimary },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "bold",
    color: THEME.textSecondary,
    textTransform: "uppercase",
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  emptyText: {
    color: THEME.textSecondary,
    fontStyle: "italic",
    paddingVertical: 10,
  },
  requestRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: THEME.border,
  },
  requestName: { fontSize: 16, fontWeight: "600", color: THEME.textPrimary },
  actionBtn: { padding: 8, borderRadius: 8 },
});
