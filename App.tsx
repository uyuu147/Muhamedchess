import React, { useMemo, useState } from "react";
import * as Updates from "expo-updates";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { Chess, Square, PieceSymbol, Color } from "chess.js";

const C = {
  bg: "#0D0F12",
  panel: "#171A1F",
  panel2: "#20242B",
  border: "#2B3038",
  gold: "#D7B56D",
  gold2: "#F0D79D",
  text: "#F4F1E9",
  muted: "#9299A4",
  light: "#E7D9BD",
  dark: "#78624D",
  selected: "#C89D4B",
  legal: "#79A88B",
  danger: "#D97777",
};

const PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎" },
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function App() {
  const { width } = useWindowDimensions();
  const boardSize = Math.min(width - 32, 440);
  const squareSize = boardSize / 8;
  const [game, setGame] = useState(() => new Chess());
  const [selected, setSelected] = useState<Square | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [revision, setRevision] = useState(0);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const turn = game.turn();
  const isOver = game.isGameOver();
  const legalTargets = useMemo(() => {
    if (!selected) return [];
    return game.moves({ square: selected, verbose: true }).map((m: any) => m.to as Square);
  }, [game, selected, revision]);

  const status = useMemo(() => {
    if (game.isCheckmate()) return `Мат. Победили ${turn === "w" ? "чёрные" : "белые"}.`;
    if (game.isStalemate()) return "Пат. Ничья.";
    if (game.isThreefoldRepetition()) return "Ничья: троекратное повторение.";
    if (game.isInsufficientMaterial()) return "Ничья: недостаточно материала.";
    if (game.isDraw()) return "Ничья.";
    return `${turn === "w" ? "Ход белых" : "Ход чёрных"}${game.isCheck() ? " · Шах" : ""}`;
  }, [game, turn, revision]);

  const moves = game.history({ verbose: true }) as any[];
  const moveRows: string[][] = [];
  for (let i = 0; i < moves.length; i += 2) {
    moveRows.push([
      String(Math.floor(i / 2) + 1),
      moves[i]?.san ?? "",
      moves[i + 1]?.san ?? "",
    ]);
  }

  function refresh() {
    setRevision((n) => n + 1);
  }

  async function checkForUpdates() {
    if (checkingUpdates) return;
    if (!Updates.isEnabled) {
      Alert.alert(
        "Обновления пока не настроены",
        "Для проверки обновлений разработчику нужно подключить проект к Expo EAS и опубликовать первую сборку с поддержкой обновлений."
      );
      return;
    }
    setCheckingUpdates(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert("Обновлений нет", "У вас установлена последняя доступная версия.");
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert("Обновление готово", "Перезапустить MuhamedChess и установить обновление?", [
        { text: "Позже", style: "cancel" },
        { text: "Обновить", onPress: () => { void Updates.reloadAsync(); } },
      ]);
    } catch (error) {
      Alert.alert(
        "Не удалось проверить обновления",
        "Проверьте подключение к интернету и попробуйте ещё раз. Если это первая установка, канал обновлений ещё может быть не опубликован."
      );
    } finally {
      setCheckingUpdates(false);
    }
  }

  function makeMove(from: Square, to: Square) {
    const piece = game.get(from);
    if (!piece) return;
    if (piece.type === "p" && (to.endsWith("8") || to.endsWith("1"))) {
      Alert.alert("Превращение пешки", "Выберите фигуру", [
        { text: "Ферзь", onPress: () => finishMove(from, to, "q") },
        { text: "Ладья", onPress: () => finishMove(from, to, "r") },
        { text: "Слон", onPress: () => finishMove(from, to, "b") },
        { text: "Конь", onPress: () => finishMove(from, to, "n") },
        { text: "Отмена", style: "cancel" },
      ]);
      return;
    }
    finishMove(from, to);
  }

  function finishMove(from: Square, to: Square, promotion?: "q" | "r" | "b" | "n") {
    try {
      const result = game.move({ from, to, ...(promotion ? { promotion } : {}) });
      if (result) {
        setSelected(null);
        refresh();
      }
    } catch {
      setSelected(null);
    }
  }

  function onSquarePress(square: Square) {
    if (isOver) return;
    const piece = game.get(square);
    if (selected && legalTargets.includes(square)) {
      makeMove(selected, square);
      return;
    }
    if (piece && piece.color === turn) {
      setSelected(square);
      return;
    }
    setSelected(null);
  }

  function newGame() {
    Alert.alert("Новая партия", "Начать новую партию? Текущая партия будет сброшена.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Начать",
        style: "destructive",
        onPress: () => {
          setGame(new Chess());
          setSelected(null);
          setRevision((n) => n + 1);
          setFlipped(false);
        },
      },
    ]);
  }

  function undoMove() {
    const replay = new Chess();
    const played = game.history({ verbose: true }) as any[];
    played.slice(0, -1).forEach((m) => {
      replay.move({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
    });
    setGame(replay);
    setSelected(null);
    setRevision((n) => n + 1);
  }

  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flipped ? [...FILES].reverse() : FILES;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>LOCAL TWO-PLAYER CHESS</Text>
            <Text style={styles.brand}>muhamed<Text style={styles.brandGold}>chess</Text></Text>
          </View>
          <View style={styles.crown}><Text style={styles.crownText}>♛</Text></View>
        </View>

        <View style={styles.statusCard}>
          <View style={[styles.turnDot, { backgroundColor: turn === "w" ? C.light : C.dark }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{status}</Text>
            <Text style={styles.statusSub}>{isOver ? "Партия завершена" : "Передайте телефон следующему игроку после хода"}</Text>
          </View>
          {game.isCheck() && !isOver ? <Text style={styles.checkTag}>ШАХ</Text> : null}
        </View>

        <View style={[styles.boardFrame, { width: boardSize + 12 }]}>
          <View style={[styles.board, { width: boardSize, height: boardSize }]}>
            {ranks.map((rank) => (
              <View key={rank} style={styles.rank}>
                {files.map((file) => {
                  const square = `${file}${rank}` as Square;
                  const piece = game.get(square);
                  const isLight = (FILES.indexOf(file) + rank) % 2 === 0;
                  const isSelected = selected === square;
                  const isTarget = legalTargets.includes(square);
                  const isCapture = isTarget && !!piece;
                  return (
                    <TouchableOpacity
                      key={square}
                      activeOpacity={0.85}
                      onPress={() => onSquarePress(square)}
                      style={[
                        styles.square,
                        { width: squareSize, height: squareSize, backgroundColor: isLight ? C.light : C.dark },
                        isSelected && styles.selectedSquare,
                      ]}
                    >
                      {isTarget ? (
                        <View style={[styles.target, isCapture && styles.captureTarget]} />
                      ) : null}
                      {piece ? (
                        <Text
                          style={[
                            styles.piece,
                            { color: piece.color === "w" ? "#FFFDF7" : "#171717" },
                            piece.color === "w" ? styles.whitePiece : styles.blackPiece,
                          ]}
                        >
                          {PIECES[piece.color][piece.type]}
                        </Text>
                      ) : null}
                      {file === files[0] ? <Text style={styles.coordRank}>{rank}</Text> : null}
                      {rank === ranks[ranks.length - 1] ? <Text style={styles.coordFile}>{file}</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.playerRow}>
          <View style={styles.playerBadge}><Text style={styles.playerIcon}>♚</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.playerName}>Игрок 2</Text>
            <Text style={styles.playerColor}>ЧЁРНЫЕ</Text>
          </View>
          <Text style={styles.playerTurn}>{turn === "b" && !isOver ? "ХОДИТ" : " "}</Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.secondaryButton} onPress={undoMove} disabled={moves.length === 0}>
            <Text style={[styles.secondaryButtonText, moves.length === 0 && styles.disabledText]}>↶  Отменить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setFlipped((f) => !f)}>
            <Text style={styles.secondaryButtonText}>⇅  Перевернуть</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={newGame}>
            <Text style={styles.primaryButtonText}>Новая партия</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.playerRow}>
          <View style={styles.playerBadge}><Text style={styles.playerIcon}>♔</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.playerName}>Игрок 1</Text>
            <Text style={styles.playerColor}>БЕЛЫЕ</Text>
          </View>
          <Text style={styles.playerTurn}>{turn === "w" && !isOver ? "ХОДИТ" : " "}</Text>
        </View>

        <View style={styles.updateCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.updateTitle}>ОБНОВЛЕНИЯ</Text>
            <Text style={styles.updateSub}>Проверяйте новые версии MuhamedChess</Text>
          </View>
          <TouchableOpacity
            style={[styles.updateButton, checkingUpdates && styles.updateButtonDisabled]}
            onPress={checkForUpdates}
            disabled={checkingUpdates}
          >
            <Text style={styles.updateButtonText}>{checkingUpdates ? "Проверка…" : "Проверить"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.historyCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>ХОДЫ ПАРТИИ</Text>
            <Text style={styles.moveCount}>{moves.length} {moves.length === 1 ? "ход" : "ходов"}</Text>
          </View>
          {moveRows.length === 0 ? (
            <Text style={styles.emptyHistory}>История ходов появится здесь</Text>
          ) : (
            moveRows.slice(-8).map((row) => (
              <View key={row[0]} style={styles.historyRow}>
                <Text style={styles.moveNumber}>{row[0].padStart(2, "0")}</Text>
                <Text style={styles.moveWhite}>{row[1]}</Text>
                <Text style={styles.moveBlack}>{row[2]}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.footer}>MUHAMEDCHESS  ·  ИГРА НА ОДНОМ УСТРОЙСТВЕ</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { alignItems: "center", paddingHorizontal: 16, paddingTop: 18, paddingBottom: 36 },
  header: { width: "100%", maxWidth: 460, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
  eyebrow: { color: C.muted, fontSize: 9, letterSpacing: 2.2, fontWeight: "700", marginBottom: 5 },
  brand: { color: C.text, fontSize: 29, fontWeight: "800", letterSpacing: -1.2 },
  brandGold: { color: C.gold },
  crown: { width: 48, height: 48, borderRadius: 16, borderWidth: 1, borderColor: "#55472E", backgroundColor: "#211D16", alignItems: "center", justifyContent: "center" },
  crownText: { color: C.gold2, fontSize: 30 },
  statusCard: { width: "100%", maxWidth: 460, minHeight: 66, paddingHorizontal: 15, paddingVertical: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 16, flexDirection: "row", alignItems: "center", marginBottom: 16 },
  turnDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12, borderWidth: 1, borderColor: "#6F7379" },
  statusTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  statusSub: { color: C.muted, fontSize: 10, marginTop: 4 },
  checkTag: { color: C.danger, fontWeight: "800", fontSize: 10, letterSpacing: 1 },
  boardFrame: { padding: 6, backgroundColor: "#29251F", borderRadius: 12, borderWidth: 1, borderColor: "#514431", alignItems: "center", marginBottom: 15 },
  board: { overflow: "hidden", borderRadius: 5 },
  rank: { flexDirection: "row" },
  square: { alignItems: "center", justifyContent: "center", position: "relative" },
  selectedSquare: { borderWidth: 3, borderColor: C.gold2 },
  piece: { fontSize: 35, textAlign: "center", textAlignVertical: "center", includeFontPadding: false },
  whitePiece: { textShadowColor: "#28231D", textShadowRadius: 2, textShadowOffset: { width: 1, height: 1 } },
  blackPiece: { textShadowColor: "#F2E8D6", textShadowRadius: 1, textShadowOffset: { width: 0, height: 0 } },
  target: { position: "absolute", width: "25%", height: "25%", borderRadius: 30, backgroundColor: C.legal, opacity: 0.85, zIndex: 1 },
  captureTarget: { width: "86%", height: "86%", backgroundColor: "transparent", borderWidth: 4, borderColor: C.legal },
  coordRank: { position: "absolute", top: 2, left: 3, color: "#3C3328", fontSize: 8, fontWeight: "800" },
  coordFile: { position: "absolute", bottom: 1, right: 3, color: "#3C3328", fontSize: 8, fontWeight: "800" },
  playerRow: { width: "100%", maxWidth: 460, flexDirection: "row", alignItems: "center", paddingHorizontal: 3, paddingVertical: 9 },
  playerBadge: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center", marginRight: 10, borderWidth: 1, borderColor: C.border },
  playerIcon: { fontSize: 22, color: C.gold2 },
  playerName: { color: C.text, fontSize: 13, fontWeight: "700" },
  playerColor: { color: C.muted, fontSize: 9, letterSpacing: 1.5, marginTop: 2, fontWeight: "700" },
  playerTurn: { color: C.gold, fontSize: 9, letterSpacing: 1.2, fontWeight: "800" },
  controls: { width: "100%", maxWidth: 460, flexDirection: "row", gap: 7, marginVertical: 4 },
  secondaryButton: { flex: 1, minHeight: 43, paddingHorizontal: 6, borderRadius: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: C.text, fontSize: 10, fontWeight: "700" },
  disabledText: { color: "#555B64" },
  primaryButton: { flex: 1.15, minHeight: 43, paddingHorizontal: 8, borderRadius: 12, backgroundColor: C.gold, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#19150E", fontSize: 10, fontWeight: "900" },
  updateCard: { width: "100%", maxWidth: 460, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, marginTop: 14 },
  updateTitle: { color: C.gold2, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  updateSub: { color: C.muted, fontSize: 10, marginTop: 5 },
  updateButton: { backgroundColor: C.gold, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  updateButtonDisabled: { opacity: 0.55 },
  updateButtonText: { color: "#19150E", fontSize: 10, fontWeight: "900" },
  historyCard: { width: "100%", maxWidth: 460, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 15, marginTop: 14 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { color: C.gold2, fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  moveCount: { color: C.muted, fontSize: 10 },
  emptyHistory: { color: "#69717C", fontSize: 11, paddingVertical: 10, textAlign: "center" },
  historyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#252A31" },
  moveNumber: { color: C.muted, width: 35, fontSize: 11 },
  moveWhite: { color: C.text, flex: 1, fontSize: 12, fontWeight: "600" },
  moveBlack: { color: "#B7A27C", flex: 1, fontSize: 12, fontWeight: "600" },
  footer: { color: "#505761", fontSize: 8, letterSpacing: 1.5, marginTop: 22 },
});
export default App;
