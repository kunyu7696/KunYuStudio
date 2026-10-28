package com.kunyu.observer.mixin;

import com.kunyu.observer.state.ChatRing;
import net.minecraft.client.gui.hud.ChatHud;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 拦截 ChatHud#addMessage(Text)，把聊天纯文本抄送到 {@link ChatRing}，
 * 供工作台 /v1/chat 端点读取最近聊天（命令反馈、系统消息都经过这里）。
 */
@Mixin(ChatHud.class)
public class ChatHudMixin {
    @Inject(method = "addMessage(Lnet/minecraft/text/Text;)V", at = @At("HEAD"))
    private void kunyu$capture(Text message, CallbackInfo ci) {
        if (message != null) {
            ChatRing.add(message.getString());
        }
    }
}
