import baseConfig from "@yopem/oxlint-config"
import reactConfig from "@yopem/oxlint-config/react"

export default {
  extends: [baseConfig, reactConfig],
  options: baseConfig.options,
}
