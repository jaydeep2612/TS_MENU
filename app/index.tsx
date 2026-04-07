import { MaterialIcons } from "@expo/vector-icons";
import {
  router,
  useLocalSearchParams,
  useRootNavigationState,
} from "expo-router";
import * as Updates from "expo-updates";
import {
  default as React,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../constants/theme";
import { useSession } from "../context/SessionContext";
import { initEcho } from "../services/echo";
import { SessionService } from "../services/session.service";

export default function JoinScreen() {
  const rootNavigationState = useRootNavigationState();

  const {
    startSession,
    customerName,
    setCustomerName,
    sessionToken,
    setTableData,
    tableData,
    joinStatus,
    setJoinStatus,
    clearSession,
  } = useSession();

  const { r, t, token } = useLocalSearchParams<{
    r: string;
    t: string;
    token: string;
  }>();

  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [isTableFull, setIsTableFull] = useState(false);
  const [isTableReserved, setIsTableReserved] = useState(false);
  const [existingHostName, setExistingHostName] = useState<string | null>(null);
  const [showJoinChoice, setShowJoinChoice] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"new" | "join">("new");
  const [tableDisplayNumber, setTableDisplayNumber] = useState<string | null>(
    null,
  );

  const initTable = useCallback(async () => {
    if (r && t && token) {
      if (tableData?.tId !== t || tableData?.token !== token) {
        setTableData({ rId: r, tId: t, token });
      }
      try {
        const data = await SessionService.validateTable(r, t, token);

        if (data.table_number) {
          setTableDisplayNumber(data.table_number);
        }

        if (data.is_reserved) {
          setIsTableReserved(true);
          setValidating(false);
          return;
        }

        if (data.is_full) {
          setIsTableFull(true);
          setValidating(false);
          return;
        }

        if (data.has_active_host) {
          setExistingHostName(data.host_name);
          setShowJoinChoice(true);
          setSelectedMode("join");
        } else {
          setShowJoinChoice(false);
          setSelectedMode("new");
        }
      } catch (e: any) {
        const isAbort =
          e.name === "AbortError" || e.message?.toLowerCase().includes("abort");
        if (!isAbort) {
          console.error("Validation failed", e);
        }
      } finally {
        setValidating(false);
      }
    } else {
      setValidating(false);
    }
  }, [r, t, token, tableData, setTableData]);

  useEffect(() => {
    initTable();
  }, [initTable]);

  const echoRef = useRef<any>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    let channel: any = null;
    let pollInterval: ReturnType<typeof setInterval>;

    const setupRealtime = async () => {
      if (joinStatus === "pending" && tableData && sessionToken) {
        try {
          await SessionService.checkSessionStatus(
            tableData.rId,
            tableData.tId,
            tableData.token,
            sessionToken,
          );
          if (isMountedRef.current) setJoinStatus("approved");
        } catch (e: any) {
          const sessionId = e.data?.session?.id;
          if (
            e.status === 403 &&
            e.data?.join_status === "pending" &&
            sessionId
          ) {
            if (!echoRef.current) echoRef.current = initEcho(sessionToken);
            echoRef.current.leaveAllChannels();

            channel = echoRef.current.private(`session.${sessionId}`);
            channel.listen(".JoinRequestResponded", (event: any) => {
              if (!isMountedRef.current) return;
              if (event.status === "approved") {
                setJoinStatus("approved");
              } else if (event.status === "rejected") {
                setJoinStatus("rejected");
              }
            });

            pollInterval = setInterval(async () => {
              try {
                await SessionService.checkSessionStatus(
                  tableData.rId,
                  tableData.tId,
                  tableData.token,
                  sessionToken,
                );
                if (isMountedRef.current) setJoinStatus("approved");
              } catch (err: any) {
                if (
                  err?.data?.join_status === "rejected" &&
                  isMountedRef.current
                ) {
                  setJoinStatus("rejected");
                }
              }
            }, 3000);
          } else if (e.status === 404 || e.data?.join_status === "rejected") {
            if (isMountedRef.current) setJoinStatus("rejected");
          }
        }
      }
    };

    setupRealtime();

    return () => {
      isMountedRef.current = false;
      if (pollInterval) clearInterval(pollInterval);
      if (echoRef.current) {
        echoRef.current.disconnect();
        echoRef.current = null;
      }
    };
  }, [joinStatus, sessionToken, tableData]);

  useEffect(() => {
    if (
      sessionToken &&
      (joinStatus === "active" || joinStatus === "approved")
    ) {
      router.replace("/(tabs)/menu");
    }
  }, [sessionToken, joinStatus]);

  const handleJoin = useCallback(async () => {
    if (!customerName.trim()) return;
    setLoading(true);
    try {
      await startSession(customerName, selectedMode);
    } catch (e: any) {
      if (
        e?.data?.message === "TABLE_RESERVED" ||
        e?.message?.includes("TABLE_RESERVED")
      ) {
        setIsTableReserved(true);
      } else {
        console.error(e);
        Alert.alert("Error", "Could not join table. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [customerName, selectedMode, startSession]);

  if (!rootNavigationState?.key) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color={THEME.primary} />
      </SafeAreaView>
    );
  }

  if (validating && r && t && token) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={THEME.primary} />
        <Text style={{ marginTop: 16, color: THEME.textSecondary }}>
          Checking table status...
        </Text>
      </View>
    );
  }

  if (!r || !t || !token) {
    return (
      <SafeAreaView
        style={[styles.centerContainer, { backgroundColor: "#23140f" }]}
      >
        <View style={{ alignItems: "center", marginBottom: 40 }}>
          <MaterialIcons
            name="restaurant-menu"
            size={80}
            color={THEME.primary}
          />
          <Text
            style={{
              fontSize: 32,
              fontWeight: "bold",
              color: "#fff",
              marginTop: 16,
            }}
          >
            TechStrota POS
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
            Please scan a QR code to order
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isTableReserved) {
    return (
      <View style={styles.centerContainer}>
        <MaterialIcons name="calendar-today" size={80} color="#ec4899" />
        <Text style={styles.welcomeTitle}>Table Reserved</Text>
        <Text style={styles.subtitle}>
          This table is currently reserved for upcoming guests. Please scan the
          QR code on a different available table.
        </Text>
        <TouchableOpacity
          onPress={async () => await Updates.reloadAsync()}
          style={[
            styles.joinButton,
            {
              width: "80%",
              marginTop: 32,
              backgroundColor: THEME.textSecondary,
            },
          ]}
        >
          <Text style={styles.joinButtonText}>Check Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (joinStatus === "rejected") {
    return (
      <View style={styles.centerContainer}>
        <MaterialIcons name="cancel" size={80} color={THEME.danger} />
        <Text style={styles.welcomeTitle}>Access Denied</Text>
        <Text style={styles.subtitle}>
          The Host has declined your request to join this table.
        </Text>
        <TouchableOpacity
          onPress={clearSession}
          style={[styles.joinButton, { width: "80%", marginTop: 24 }]}
        >
          <Text style={styles.joinButtonText}>Start Over</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isTableFull) {
    return (
      <View style={styles.centerContainer}>
        <MaterialIcons name="event-seat" size={80} color={THEME.warning} />
        <Text style={styles.welcomeTitle}>Table is Full</Text>
        <Text style={styles.subtitle}>
          Sorry, this table has reached its maximum seating capacity. Please
          speak to the staff.
        </Text>
        <TouchableOpacity
          onPress={async () => await Updates.reloadAsync()}
          style={[
            styles.joinButton,
            {
              width: "80%",
              marginTop: 24,
              backgroundColor: THEME.textSecondary,
            },
          ]}
        >
          <Text style={styles.joinButtonText}>Refresh Status</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (joinStatus === "pending") {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={THEME.warning} />
        <Text style={styles.welcomeTitle}>Waiting...</Text>
        <Text style={styles.subtitle}>
          Waiting for{" "}
          <Text style={{ fontWeight: "bold", color: THEME.textPrimary }}>
            {existingHostName || "Host"}
          </Text>{" "}
          to approve you.
        </Text>
        <TouchableOpacity onPress={clearSession} style={{ marginTop: 32 }}>
          <Text style={{ color: THEME.danger, fontWeight: "bold" }}>
            Cancel Request
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isButtonDisabled = !customerName.trim() || loading;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="restaurant" size={24} color={THEME.primary} />
        </View>
        <Text style={styles.headerTitle}>Welcome to our Restaurant</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.welcomeTitle}>Welcome!</Text>

        <View style={styles.tableBadge}>
          <MaterialIcons
            name="local-activity"
            size={16}
            color={THEME.primary}
          />
          <Text style={styles.tableBadgeText}>
            {tableDisplayNumber
              ? `Table ${tableDisplayNumber}`
              : `Table #${tableData?.tId || "?"}`}
          </Text>
        </View>

        {showJoinChoice ? (
          <View style={{ width: "100%", marginBottom: 24 }}>
            <Text
              style={[styles.subtitle, { textAlign: "left", marginBottom: 12 }]}
            >
              Hosted by{" "}
              <Text style={{ fontWeight: "bold", color: THEME.textPrimary }}>
                {existingHostName}
              </Text>
              . How do you want to order?
            </Text>
            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedMode === "join" && styles.choiceCardActive,
              ]}
              onPress={() => setSelectedMode("join")}
            >
              <MaterialIcons
                name="group"
                size={28}
                color={selectedMode === "join" ? "#FFF" : THEME.textPrimary}
              />
              <View style={{ marginLeft: 16 }}>
                <Text
                  style={[
                    styles.choiceTitle,
                    selectedMode === "join" && { color: "#FFF" },
                  ]}
                >
                  Join the Table
                </Text>
                <Text
                  style={[
                    styles.choiceDesc,
                    selectedMode === "join" && {
                      color: "rgba(255,255,255,0.8)",
                    },
                  ]}
                >
                  Orders added to {existingHostName}'s bill
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedMode === "new" && styles.choiceCardActive,
              ]}
              onPress={() => setSelectedMode("new")}
            >
              <MaterialIcons
                name="receipt-long"
                size={28}
                color={selectedMode === "new" ? "#FFF" : THEME.textPrimary}
              />
              <View style={{ marginLeft: 16 }}>
                <Text
                  style={[
                    styles.choiceTitle,
                    selectedMode === "new" && { color: "#FFF" },
                  ]}
                >
                  Separate Bill
                </Text>
                <Text
                  style={[
                    styles.choiceDesc,
                    selectedMode === "new" && {
                      color: "rgba(255,255,255,0.8)",
                    },
                  ]}
                >
                  Start your own separate tab
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.subtitle, { marginBottom: 32 }]}>
            Enter your name to start ordering.
          </Text>
        )}

        <View style={styles.formArea}>
          <Text style={styles.label}>Your Name</Text>
          <View style={styles.inputContainer}>
            <MaterialIcons
              name="person"
              size={24}
              color={THEME.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="e.g. John Doe"
              placeholderTextColor="#94A3B8"
              value={customerName}
              onChangeText={setCustomerName}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.joinButton,
              isButtonDisabled && { opacity: 0.6 },
              Platform.OS === "web" && ({ cursor: "pointer" } as any),
            ]}
            onPress={handleJoin}
            disabled={isButtonDisabled}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.joinButtonText}>
                {showJoinChoice && selectedMode === "join"
                  ? "Request to Join"
                  : "Start Session"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.background },
  centerContainer: {
    flex: 1,
    backgroundColor: THEME.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: THEME.textPrimary },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: THEME.textPrimary,
    marginBottom: 8,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 15,
    color: THEME.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  tableBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
  },
  tableBadgeText: { color: THEME.primary, fontWeight: "bold", marginLeft: 6 },
  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: THEME.border,
    backgroundColor: THEME.cardBg,
    marginBottom: 12,
  },
  choiceCardActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary,
  },
  choiceTitle: {
    fontWeight: "bold",
    fontSize: 16,
    color: THEME.textPrimary,
    marginBottom: 2,
  },
  choiceDesc: { fontSize: 13, color: THEME.textSecondary },
  formArea: { width: "100%" },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: THEME.textPrimary,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.cardBg,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    height: 56,
    marginBottom: 24,
  },
  inputIcon: { paddingHorizontal: 16 },
  input: { flex: 1, fontSize: 16, color: THEME.textPrimary },
  joinButton: {
    backgroundColor: THEME.primary,
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: 12,
  },
  joinButtonText: { color: "#FFF", fontSize: 16, fontWeight: "bold" },
});
