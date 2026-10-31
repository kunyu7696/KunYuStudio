// ============================================================================
// ModClient.java - Fabric {{mcVersion}} reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Client-only entrypoint (renders, screens, client networking).
// Target mapping: Yarn {{yarnMappings}} | Loader {{detail4}} | JDK {{jdk}}
// ============================================================================
package com.example.mod;

import net.fabricmc.api.ClientModInitializer;

public class ModClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ModMain.LOGGER.info("Initializing {} (client)", ModMain.MOD_ID);
        // Client-only registrations: renderers, screens, key bindings.
    }
}
