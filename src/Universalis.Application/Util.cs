﻿using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Universalis.Application.Views.V1;
using Universalis.Entities.MarketBoard;

namespace Universalis.Application;

public static partial class Util
{
    private static readonly Regex HtmlTags = HtmlTagsRegex();

    // TODO: Implement tests to determine if this can be replaced with [^\p{L}\p{M}\p{N}'-]
    private static readonly Regex UnsafeCharacters =
        UnsafeCharactersRegex();

    [GeneratedRegex("<[\\s\\S]*?>", RegexOptions.IgnoreCase | RegexOptions.Compiled, "en-US")]
    private static partial Regex HtmlTagsRegex();

    [GeneratedRegex("[^a-zA-Z0-9'\\- ·⺀-⺙⺛-⻳⼀-⿕々〇〡-〩〸-〺〻㐀-䶵一-鿃豈-鶴侮-頻並-龎]", RegexOptions.Compiled)]
    private static partial Regex UnsafeCharactersRegex();

    public static SaleView SaleToView(Sale s)
    {
        var quantity = s.Quantity ?? 0;
        return new SaleView
        {
            Hq = s.Hq,
            PricePerUnit = s.PricePerUnit,
            Quantity = quantity,
            Total = s.PricePerUnit * quantity,
            TimestampUnixSeconds = new DateTimeOffset(s.SaleTime).ToUnixTimeSeconds(),
            BuyerName = s.BuyerName,
            OnMannequin = s.OnMannequin,
        };
    }

    /// <summary>
    /// Converts a database listing into a listing view to be returned to external clients.
    /// </summary>
    /// <param name="l">The database listing.</param>
    /// <returns>A listing view associated with the provided listing.</returns>
    public static ListingView ListingToView(Listing l)
    {
        var ppu = l.PricePerUnit;
        var listingView = new ListingView
        {
            Hq = l.Hq,
            OnMannequin = l.OnMannequin,
            Materia = l.Materia?
                .Select(m => new MateriaView
                {
                    SlotId = m.SlotId,
                    MateriaId = m.MateriaId,
                })
                .ToList() ?? new List<MateriaView>(),
            PricePerUnit = ppu,
            Quantity = l.Quantity,
            Total = ppu * l.Quantity,
            DyeId = l.DyeId,
            CreatorName = l.CreatorName ?? "",
            IsCrafted = !string.IsNullOrEmpty(l.CreatorId),
            LastReviewTimeUnixSeconds = new DateTimeOffset(l.LastReviewTime).ToUnixTimeSeconds(),
            RetainerName = l.RetainerName,
            RetainerCityId = l.RetainerCityId,
        };

        using var sha256 = SHA256.Create();

        if (!string.IsNullOrEmpty(l.CreatorId))
        {
            listingView.CreatorIdHash = Hash(sha256, l.CreatorId);
        }

        if (!string.IsNullOrEmpty(l.ListingId))
        {
            listingView.ListingIdHash = Hash(sha256, l.ListingId);
        }

        listingView.SellerIdHash = Hash(sha256, l.SellerId);
        listingView.RetainerIdHash = Hash(sha256, l.RetainerId);

        return listingView;
    }

    /// <summary>
    /// Hashes the provided string.
    /// </summary>
    /// <param name="hasher">The hashing algorithm to use.</param>
    /// <param name="input">The input string.</param>
    /// <returns>A hash representing the input string.</returns>
    public static string Hash(HashAlgorithm hasher, string input)
    {
        Span<byte> hash = stackalloc byte[hasher.HashSize / 8];
        ReadOnlySpan<byte> bytes = Encoding.UTF8.GetBytes(input ?? "");
        if (hasher.TryComputeHash(bytes, hash, out _)) // Since we stackalloc the hash buffer, written is not needed
            return Convert.ToHexString(hash).ToLowerInvariant(); // https://github.com/dotnet/runtime/issues/60393
        throw new InvalidOperationException("Destination buffer was too small, this should never occur");
    }

    /// <summary>
    /// Returns <see langword="true" /> if the provided input contains HTML tags.
    /// </summary>
    /// <param name="input">The input text.</param>
    /// <returns><see langword="true" /> if the input contains HTML tags, otherwise <see langword="false" />.</returns>
    public static bool HasHtmlTags(string input)
    {
        return !string.IsNullOrEmpty(input) && HtmlTags.IsMatch(input);
    }

    /// <summary>
    /// Removes unsafe characters from the input text.
    /// </summary>
    /// <param name="input">The input text.</param>
    /// <returns>The input text with any unsafe characters removed.</returns>
    public static string RemoveUnsafeCharacters(string input)
    {
        return UnsafeCharacters.Replace(input, "");
    }

    /// <summary>
    /// Parses a bool that is provided as a string or a number into a proper boolean value.
    /// This function exists because of unfortunate inconsistencies in how different
    /// clients upload parsed values.
    /// </summary>
    /// <param name="o">The input object.</param>
    /// <returns>A boolean corresponding to the text.</returns>
    public static bool ParseUnusualBool(object o)
    {
        // Conversions for System.Text.Json types
        o = o switch
        {
            JsonElement { ValueKind: JsonValueKind.Number } e => e.GetDecimal().ToString(CultureInfo.InvariantCulture),
            JsonElement { ValueKind: JsonValueKind.String } e => e.GetString(),
            JsonElement { ValueKind: JsonValueKind.True } => true,
            JsonElement { ValueKind: JsonValueKind.False } => false,
            _ => o,
        };

        if (o is bool b)
        {
            return b;
        }

        if (o is int i)
        {
            return i != 0;
        }

        if (o is not string s)
        {
            return false;
        }

        s = s.ToLowerInvariant();
        return s switch
        {
            "true" or "1" => true,
            "false" or "0" => false,
            _ => false,
        };
    }

    /// <summary>
    /// Parses an ID that provided as a full ID or one with 0 as a sentinel for null into a null-if-absent string.
    /// </summary>
    /// <param name="id">The ID to parse.</param>
    /// <returns>A string corresponding to the meaning of the ID.</returns>
    public static string ParseUnusualId(object id)
    {
        return id switch
        {
            JsonElement { ValueKind: JsonValueKind.Number } e => e.GetDecimal().ToString(CultureInfo.InvariantCulture),
            JsonElement { ValueKind: JsonValueKind.String } e => e.GetString(),

            "0" => null,
            string s => s,
            _ => null,
        };
    }

    internal static readonly AssemblyName Assembly
        = typeof(Util).Assembly.GetName();

    internal static readonly ActivitySource ActivitySource
        = new(Assembly.Name ?? "Universalis.Application", Assembly.Version?.ToString() ?? "0.0");
}