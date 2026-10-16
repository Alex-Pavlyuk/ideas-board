using Npgsql;
using NpgsqlTypes;

namespace IdeasBoard.Data;

/// <summary>
/// Parameter helpers for values that may be null.
///
/// SQLite guessed the type of a NULL from context; Postgres refuses to. An
/// untyped null in <c>WHERE (@kind IS NULL OR kind = @kind)</c> fails outright
/// with "could not determine data type of parameter", and an untyped null in an
/// INSERT arrives as text, which a bigint column rejects. Naming the type at the
/// call site is the whole fix — hence these three one-liners instead of casts
/// sprinkled through the SQL.
/// </summary>
internal static class Sql
{
    public static void AddOptional(this NpgsqlCommand cmd, string name, long? value) =>
        cmd.Parameters.Add(new NpgsqlParameter(name, NpgsqlDbType.Bigint)
        {
            Value = value.HasValue ? value.Value : DBNull.Value,
        });

    public static void AddOptional(this NpgsqlCommand cmd, string name, int? value) =>
        cmd.Parameters.Add(new NpgsqlParameter(name, NpgsqlDbType.Integer)
        {
            Value = value.HasValue ? value.Value : DBNull.Value,
        });

    public static void AddOptional(this NpgsqlCommand cmd, string name, string? value) =>
        cmd.Parameters.Add(new NpgsqlParameter(name, NpgsqlDbType.Text)
        {
            Value = (object?)value ?? DBNull.Value,
        });
}
