// ============================================================================
// ModMain.java - Fabric {{mcVersion}} reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Common (client + dedicated server) entrypoint.
// Target mapping: Yarn {{yarnMappings}} | Loader {{detail4}} | JDK {{jdk}}
// ============================================================================
package com.example.mod;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ModMain implements ModInitializer {
    public static final String MOD_ID = "examplemod";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("Initializing {} (common)", MOD_ID);
        // Register blocks, items, entities, etc. here.
    }
}
