// ============================================================================
// ModClient.java - Fabric 1.20.1 reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Client-only entrypoint (renders, screens, client networking).
// Target mapping: Yarn 1.20.1+build.10 | Loader 0.16.9 | JDK 17
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
