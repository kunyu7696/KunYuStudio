// ============================================================================
// ModServer.java - Fabric 1.20.1 reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Dedicated-server-only entrypoint.
// Target mapping: Yarn 1.20.1+build.10 | Loader 0.16.9 | JDK 17
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
