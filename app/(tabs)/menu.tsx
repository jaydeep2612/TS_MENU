import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { default as React, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  const [loadingMenu, setLoadingMenu] = useState(true);

  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [activeGuests, setActiveGuests] = useState<any[]>([]);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const echoRef = useRef<any>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  const currentSessionId =
    menuData?.session?.id ||
    menuData?.session?.session_id ||
    menuData?.session_id ||
    tableData?.tId;

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
      } catch (e) {
        setMenuData({ categories: FALLBACK_CATEGORIES });
      } finally {
        setLoadingMenu(false);
      }
    };
    loadMenu();
  }, [tableData, sessionToken]);

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
          if (res.pending && res.pending.length > 0) {
            setShowRequestsModal(true);
          }
        }
      } catch (e) {
        console.error("Failed to fetch host data", e);
      }

      if (!echoRef.current) {
        echoRef.current = initEcho(sessionToken);
      }

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

  // 👇 FIX: Process all categories with Safe Fallbacks for 'type'
  const processedCategories = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return categories
      .map((cat: any) => {
        if (cat.is_active === false || cat.is_active === 0) return null;

        const filteredItems = (cat.items || []).filter((item: any) => {
          if (item.is_available === false || item.is_available === 0)
            return false;

          // 👇 SAFE DIETARY CHECK: Default to 'veg' if the API hasn't sent the type yet
          const safeType = item.type
            ? String(item.type).toLowerCase()
            : item.is_veg
              ? "veg"
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

        return { ...cat, items: filteredItems };
      })
      .filter((cat: any) => cat && cat.items.length > 0);
  }, [categories, searchQuery, dietaryFilter]);

  const currentCatIndex = processedCategories.findIndex(
    (c: any) => c.id === activeCategoryId,
  );
  const nextCategory =
    currentCatIndex !== -1 && currentCatIndex < processedCategories.length - 1
      ? processedCategories[currentCatIndex + 1]
      : null;

  const isApproved = joinStatus === "active" || joinStatus === "approved";
  const isOrderingLocked = !isApproved;
  const restaurantName = menuData?.restaurant?.name || "Loading...";
  const restaurantLogo = menuData?.restaurant?.logo;
  const tableNumber = menuData?.table?.number || tableData?.tId || "?";
  const tableCapacity = menuData?.table?.capacity || "-";
  const displayHostName = isPrimary
    ? customerName
    : menuData?.session?.host_name || "Host";

  const renderMenuItem = (item: any) => {
    const currentQty = cart[item.id]?.qty || 0;
    const itemPrice = parseFloat(item.price) || 0;

    return (
      <View
        key={`item-${item.id}`}
        style={[styles.card, isOrderingLocked && { opacity: 0.6 }]}
      >
        <Image
          source={{
            uri:
              item.image ||
              item.image_path ||
              "https://via.placeholder.com/150",
          }}
          style={styles.cardImage}
        />
        <View style={styles.cardContent}>
          <View>
            <View style={styles.cardHeader}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>₹{itemPrice.toFixed(2)}</Text>
            </View>
            <Text style={styles.itemDesc} numberOfLines={2}>
              {item.description || item.desc}
            </Text>
          </View>

          <View style={styles.cardFooter}>
            <View
              style={{
                flexDirection: "row",
                gap: 6,
                flexWrap: "wrap",
                flex: 1,
                alignItems: "center",
              }}
            >
              {item.is_popular && (
                <View style={styles.badgePopular}>
                  <Text style={styles.badgePopularText}>POPULAR</Text>
                </View>
              )}

              {/* 👇 FIX: Safe Veg/Non-Veg Display Logic 👇 */}
              {(() => {
                const safeType = item.type
                  ? String(item.type).toLowerCase()
                  : item.is_veg
                    ? "veg"
                    : "veg";

                if (safeType === "veg") {
                  return (
                    <View style={styles.badgeVeg}>
                      <View style={styles.vegDot} />
                      <Text style={styles.badgeVegText}>VEG</Text>
                    </View>
                  );
                } else if (safeType === "non-veg") {
                  return (
                    <View style={styles.badgeNonVeg}>
                      <View style={styles.nonVegTriangle} />
                      <Text style={styles.badgeNonVegText}>NON-VEG</Text>
                    </View>
                  );
                }
                return null;
              })()}
            </View>

            {!isOrderingLocked &&
              (currentQty > 0 ? (
                <View style={styles.qtyControls}>
                  <TouchableOpacity
                    onPress={() =>
                      updateCart(item.id, -1, itemPrice, item.name)
                    }
                    style={styles.qtyBtn}
                  >
                    <MaterialIcons
                      name="remove"
                      size={16}
                      color={THEME.primary}
                    />
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{currentQty}</Text>
                  <TouchableOpacity
                    onPress={() => updateCart(item.id, 1, itemPrice, item.name)}
                    style={styles.qtyBtn}
                  >
                    <MaterialIcons name="add" size={16} color={THEME.primary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => updateCart(item.id, 1, itemPrice, item.name)}
                >
                  <Text style={styles.addBtnText}>+ Add</Text>
                </TouchableOpacity>
              ))}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
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
                color={THEME.primary}
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
            <MaterialIcons name="stars" size={12} color={THEME.warning} />
            <Text style={styles.tableSubInfoText}>Host: {displayHostName}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity style={styles.bellBtn} onPress={handleCallWaiter}>
            <MaterialIcons
              name="notifications-active"
              size={24}
              color={THEME.warning}
            />
          </TouchableOpacity>

          {isPrimary ? (
            <TouchableOpacity
              style={[
                styles.hostBadge,
                pendingRequests.length > 0 && { backgroundColor: THEME.danger },
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
          <ActivityIndicator size="large" color={THEME.primary} />
          <Text style={{ marginTop: 12, color: THEME.textSecondary }}>
            Loading Menu...
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[styles.banner, isOrderingLocked && styles.bannerLocked]}
          >
            <View>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <MaterialIcons
                  name={isApproved ? "lock-open" : "lock"}
                  size={16}
                  color={isApproved ? THEME.success : THEME.warning}
                />
                <Text
                  style={[
                    styles.bannerTitle,
                    { color: isApproved ? THEME.success : THEME.warning },
                  ]}
                >
                  {isApproved ? "Ready to Order" : "Awaiting Approval"}
                </Text>
              </View>
              <Text style={styles.bannerSub}>
                {isApproved
                  ? "Tap an item below to add it to your cart."
                  : "Ordering is locked until host approves your table."}
              </Text>
            </View>
          </View>

          <View style={styles.searchContainer}>
            <MaterialIcons
              name="search"
              size={20}
              color={THEME.textSecondary}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for dishes..."
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

          <View style={styles.dietaryFilterContainer}>
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
                  dietaryFilter === "all" && styles.dietFilterTextActive,
                ]}
              >
                All Items
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.dietFilterBtn,
                dietaryFilter === "veg" && styles.dietFilterBtnActiveVeg,
              ]}
              onPress={() => setDietaryFilter("veg")}
            >
              <View style={styles.vegDot} />
              <Text
                style={[
                  styles.dietFilterText,
                  dietaryFilter === "veg" && styles.dietFilterTextActiveVeg,
                ]}
              >
                Veg Only
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.dietFilterBtn,
                dietaryFilter === "non-veg" && styles.dietFilterBtnActiveNonVeg,
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
          </View>

          <View style={styles.menuSection}>
            {searchQuery.trim().length > 0 || dietaryFilter !== "all" ? (
              <View>
                <Text style={styles.categoryTitle}>Filtered Results</Text>
                {processedCategories.length === 0 ? (
                  <Text style={styles.emptySearchText}>
                    No items match your criteria.
                  </Text>
                ) : (
                  processedCategories.map((cat: any) => (
                    <View key={`search-cat-${cat.id}`}>
                      <Text
                        style={[
                          styles.categoryTitle,
                          {
                            fontSize: 16,
                            color: THEME.textSecondary,
                            marginTop: 12,
                          },
                        ]}
                      >
                        In {cat.name}
                      </Text>
                      {cat.items.map((item: any) => renderMenuItem(item))}
                    </View>
                  ))
                )}
              </View>
            ) : activeCategoryId === "all" ? (
              <View>
                <Text style={styles.categoryTitle}>Menu Categories</Text>
                <View style={styles.categoryGrid}>
                  {processedCategories.map((cat: any) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={styles.categoryBlock}
                      onPress={() => setActiveCategoryId(cat.id)}
                    >
                      <Text style={styles.categoryBlockText}>{cat.name}</Text>
                      <View style={styles.categoryBlockRight}>
                        <Text style={styles.categoryItemCount}>
                          {cat.items?.length || 0} items
                        </Text>
                        <MaterialIcons
                          name="chevron-right"
                          size={20}
                          color={THEME.textSecondary}
                        />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setActiveCategoryId("all")}
                >
                  <MaterialIcons
                    name="arrow-back"
                    size={20}
                    color={THEME.primary}
                  />
                  <Text style={styles.backBtnText}>Back to Categories</Text>
                </TouchableOpacity>

                {processedCategories
                  .filter((c: any) => c.id === activeCategoryId)
                  .map((cat: any) => (
                    <View key={`items-${cat.id}`}>
                      <Text style={styles.categoryTitle}>{cat.name}</Text>
                      {!cat.items || cat.items.length === 0 ? (
                        <Text style={styles.emptySearchText}>
                          No items available in this category.
                        </Text>
                      ) : (
                        cat.items.map((item: any) => renderMenuItem(item))
                      )}
                    </View>
                  ))}

                {nextCategory && (
                  <TouchableOpacity
                    style={styles.nextCategoryBtn}
                    onPress={() => setActiveCategoryId(nextCategory.id)}
                  >
                    <Text style={styles.nextCategoryBtnText}>
                      Next: {nextCategory.name}
                    </Text>
                    <MaterialIcons
                      name="arrow-forward"
                      size={20}
                      color={THEME.primary}
                    />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      )}

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
                  color={THEME.primary}
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
                        color={THEME.warning}
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.requestName}>{r.customer_name}</Text>
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
                <Text style={styles.emptyText}>No guests have joined yet.</Text>
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
                      <Text style={styles.requestName}>{g.customer_name}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.background,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "rgba(250, 250, 250, 0.95)",
  },
  iconBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 20,
  },
  bellBtn: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    padding: 6,
    borderRadius: 20,
  },
  topBarTitle: { fontSize: 16, fontWeight: "bold", color: THEME.textPrimary },
  hostBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  hostBadgeText: { color: "#FFF", fontWeight: "bold", fontSize: 14 },
  scrollContent: { paddingBottom: 100 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: THEME.successLight,
    borderWidth: 1,
    borderColor: "rgba(76, 175, 80, 0.2)",
    padding: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  bannerLocked: {
    backgroundColor: "rgba(255, 193, 7, 0.1)",
    borderColor: "rgba(255, 193, 7, 0.3)",
  },
  bannerTitle: { fontSize: 14, fontWeight: "bold", color: THEME.success },
  bannerSub: { fontSize: 12, color: THEME.textSecondary, marginTop: 4 },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    height: 44,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    color: THEME.textPrimary,
    fontSize: 15,
  },
  dietaryFilterContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  dietFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: "#FFF",
  },
  dietFilterBtnActive: {
    backgroundColor: THEME.textPrimary,
    borderColor: THEME.textPrimary,
  },
  dietFilterBtnActiveVeg: {
    backgroundColor: "#ecfdf5",
    borderColor: "#10b981",
  },
  dietFilterBtnActiveNonVeg: {
    backgroundColor: "#fef2f2",
    borderColor: "#ef4444",
  },
  dietFilterText: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.textSecondary,
  },
  dietFilterTextActive: { color: "#FFF" },
  dietFilterTextActiveVeg: { color: "#047857" },
  dietFilterTextActiveNonVeg: { color: "#b91c1c" },
  categoryTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 16,
  },
  categoryGrid: { flexDirection: "column", gap: 12 },
  categoryBlock: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: THEME.cardBg,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  categoryBlockText: {
    fontSize: 16,
    fontWeight: "bold",
    color: THEME.textPrimary,
  },
  categoryBlockRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  categoryItemCount: {
    fontSize: 13,
    color: THEME.textSecondary,
    fontWeight: "500",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginBottom: 16,
    gap: 4,
    paddingVertical: 6,
    paddingRight: 12,
  },
  backBtnText: { color: THEME.primary, fontWeight: "bold", fontSize: 15 },
  emptySearchText: {
    color: THEME.textSecondary,
    fontStyle: "italic",
    marginTop: 8,
    fontSize: 15,
    marginBottom: 20,
  },
  nextCategoryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.primaryLight,
    padding: 14,
    borderRadius: 12,
    marginTop: 24,
    marginBottom: 16,
    gap: 8,
  },
  nextCategoryBtnText: {
    color: THEME.primary,
    fontWeight: "bold",
    fontSize: 16,
  },
  menuSection: { paddingHorizontal: 16 },
  card: {
    flexDirection: "row",
    backgroundColor: THEME.cardBg,
    padding: 12,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    ...Platform.select({
      web: { boxShadow: "0px 2px 6px rgba(0,0,0,0.05)" } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 2,
      },
    }),
  },
  cardImage: {
    width: 100,
    height: 100,
    borderRadius: 12,
    marginRight: 16,
    backgroundColor: THEME.border,
  },
  cardContent: { flex: 1, justifyContent: "space-between" },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "bold",
    color: THEME.textPrimary,
    flex: 1,
    paddingRight: 8,
  },
  itemPrice: { fontSize: 16, fontWeight: "bold", color: THEME.primary },
  itemDesc: { fontSize: 13, color: THEME.textSecondary, lineHeight: 18 },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  badgePopular: {
    backgroundColor: THEME.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgePopularText: {
    fontSize: 9,
    fontWeight: "bold",
    color: THEME.primary,
    letterSpacing: 0.5,
  },
  badgeVeg: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  vegDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10b981" },
  badgeVegText: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#047857",
    letterSpacing: 0.5,
  },
  badgeNonVeg: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
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
  },
  badgeNonVegText: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#b91c1c",
    letterSpacing: 0.5,
  },
  addBtn: {
    backgroundColor: THEME.primary,
    paddingHorizontal: 20,
    height: 32,
    justifyContent: "center",
    borderRadius: 8,
  },
  addBtnText: { color: "#FFF", fontWeight: "bold", fontSize: 13 },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 8,
    height: 32,
  },
  qtyBtn: { paddingHorizontal: 8, height: "100%", justifyContent: "center" },
  qtyText: {
    fontWeight: "bold",
    fontSize: 14,
    width: 20,
    textAlign: "center",
    color: THEME.textPrimary,
  },
  cartBar: { position: "absolute", bottom: 16, left: 16, right: 16 },
  cartButton: {
    backgroundColor: THEME.primary,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: "0px 4px 12px rgba(255, 107, 53, 0.3)" } as any,
      default: {
        shadowColor: THEME.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
      },
    }),
  },
  cartIconWrapper: {
    width: 36,
    height: 36,
    backgroundColor: "#FFF",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  cartQty: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "600" },
  cartTotal: { color: "#FFF", fontSize: 18, fontWeight: "bold" },
  viewCartText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 4,
  },
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
