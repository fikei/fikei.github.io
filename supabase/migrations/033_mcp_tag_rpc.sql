-- Migration: 033_mcp_tag_rpc
-- Adds RPC function for atomic batch tag add/remove on the links table.
-- Used by the MCP connector's batch_tag_pins tool.
-- Falls back to TypeScript fetch-and-update if this function doesn't exist.

CREATE OR REPLACE FUNCTION append_tags_to_pins(
  p_user_id UUID,
  p_pin_ids TEXT[],
  p_add_tags TEXT[] DEFAULT NULL,
  p_remove_tags TEXT[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INTEGER;
BEGIN
  -- Update tags column: add new tags (deduplicated), remove specified tags
  UPDATE links
  SET
    tags = (
      SELECT array_agg(DISTINCT t)
      FROM (
        -- Start with existing tags (or empty)
        SELECT unnest(COALESCE(tags, ARRAY[]::TEXT[])) AS t
        UNION
        -- Add new tags
        SELECT unnest(COALESCE(p_add_tags, ARRAY[]::TEXT[])) AS t
      ) sub
      WHERE t IS NOT NULL
        AND (p_remove_tags IS NULL OR t != ALL(p_remove_tags))
    ),
    updated_at = now()
  WHERE user_id = p_user_id
    AND id = ANY(p_pin_ids);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Grant execute to service_role (edge functions use this)
GRANT EXECUTE ON FUNCTION append_tags_to_pins(UUID, TEXT[], TEXT[], TEXT[]) TO service_role;
