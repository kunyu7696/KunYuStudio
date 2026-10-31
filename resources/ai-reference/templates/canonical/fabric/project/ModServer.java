// ============================================================================
// ModServer.java - Fabric {{mcVersion}} reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Dedicated-server-only entrypoint.
// Target mapping: Yarn {{yarnMappings}} | Loader {{detail4}} | JDK {{jdk}}
// ============================================================================
package com.example.mod;

import net.fabricmc.api.DedicatedServerModInitializer;

public class ModServer implements DedicatedServerModInitializer {
    @Override
    public void onInitializeServer() {
        ModMain.LOGGER.info("Initializing {} (dedicated server)", ModMain.MOD_ID);
        // Server-only registrations: commands, server events.
    }
}
