# 网络包（Networking / C2S / S2C）

Fabric Networking API v1，自定义 payload 同步客户端与服务端状态。

## 定义 Payload

1.20.1 用 `CustomPayload` 接口 + `PacketCodec`：

```java
public record ManaPayload(int mana) implements CustomPayload {
    public static final CustomPayload.Id<ManaPayload> ID =
        new CustomPayload.Id<>(new Identifier("mymod", "mana"));
    public static final PacketCodec<RegistryByteBuf, ManaPayload> CODEC =
        PacketCodec.of((v, buf) -> buf.writeVarInt(v.mana),
                       buf -> new ManaPayload(buf.readVarInt()));
    @Override public Id<? extends CustomPayload> getId() { return ID; }
}
```

## 注册接收器

```java
// 服务端收 C2S（client 入口之外，主入口注册）
ServerPlayNetworking.registerGlobalReceiver(ManaPayload.ID, (payload, context) -> {
    ServerPlayerEntity player = context.player();
    context.server().execute(() -> { /* 主线程改状态 */ });
});

// 客户端收 S2C（client 入口注册）
ClientPlayNetworking.registerGlobalReceiver(ManaPayload.ID, (payload, context) -> {
    ClientPlayerEntity player = context.player();
    context.client().execute(() -> ClientManaState.set(payload.mana()));
});
```

## 发送

- S2C：`ServerPlayNetworking.send(serverPlayer, payload)`
- C2S：`ClientPlayNetworking.send(payload)`

## 编解码要点

- `RegistryByteBuf`：writeVarInt/readVarInt、writeIdentifier、writeEnumConstant
- 物品栈 `ItemStack.PACKET_CODEC`；文本 `Text` 用 `writeText`/`readText`
- 包体尽量小：只同步变化的字段，高频包（每 tick）考虑节流
- 接收回调在网络线程，任何世界/实体操作必须 `context.server().execute(...)` / `context.client().execute(...)` 切回主线程

## 安全

- 服务端永远不要信任 C2S 内容：校验距离、权限、数值范围（反作弊）
- 不要在网络包里传 NBT 全量物品，除非必要
